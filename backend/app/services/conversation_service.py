"""Conversation listing, creation, and membership administration."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session, selectinload

from app.core import colors, mock_crypto
from app.models import (
    Contact,
    Conversation,
    ConversationMember,
    ConversationType,
    MemberRole,
    Message,
    User,
    utcnow,
)
from app.schemas.conversation import (
    ConversationOut,
    ConversationUpdate,
    GroupConversationCreate,
    MemberOut,
    MemberStateUpdate,
)
from app.schemas.user import SafetyNumberOut, UserPublic
from app.services import message_service


class ConversationError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# --------------------------------------------------------------------------- #
# Access
# --------------------------------------------------------------------------- #


def get_for_user(db: Session, conversation_id: str, user_id: str) -> Conversation:
    """Load a conversation, asserting the caller is a member.

    Every route funnels through this, so membership is the single authorisation
    gate for reading or writing anything inside a conversation.
    """
    conversation = db.get(
        Conversation,
        conversation_id,
        options=[selectinload(Conversation.members).joinedload(ConversationMember.user)],
    )
    if conversation is None:
        raise ConversationError("Conversation not found", 404)
    if user_id not in conversation.member_ids():
        # 404 rather than 403: don't confirm that an id exists to a non-member.
        raise ConversationError("Conversation not found", 404)
    return conversation


def member_of(conversation: Conversation, user_id: str) -> ConversationMember | None:
    for member in conversation.members:
        if member.user_id == user_id:
            return member
    return None


def _require_admin(conversation: Conversation, user_id: str) -> ConversationMember:
    member = member_of(conversation, user_id)
    if member is None:
        raise ConversationError("Conversation not found", 404)
    if not conversation.is_group:
        raise ConversationError("Direct conversations have no admins", 422)
    if not member.is_admin:
        raise ConversationError("Only group admins can do that", 403)
    return member


# --------------------------------------------------------------------------- #
# Serialisation
# --------------------------------------------------------------------------- #


def _direct_counterpart(conversation: Conversation, viewer_id: str) -> User | None:
    """The other participant, or the viewer for a Note to Self thread."""
    others = [m.user for m in conversation.members if m.user_id != viewer_id]
    if others:
        return others[0]
    members = [m.user for m in conversation.members]
    return members[0] if members else None


def _nickname_for(db: Session, owner_id: str, contact_user_id: str) -> str | None:
    """A viewer's own name for a contact, which overrides their display name."""
    return db.scalar(
        select(Contact.nickname).where(
            Contact.owner_id == owner_id,
            Contact.contact_user_id == contact_user_id,
            Contact.nickname.isnot(None),
        )
    )


def serialize(db: Session, conversation: Conversation, viewer_id: str) -> ConversationOut:
    """Render a conversation from one viewer's perspective.

    Title, unread count, mute and pin state are all viewer-relative, which is why
    this cannot be a plain ``from_attributes`` model.
    """
    member = member_of(conversation, viewer_id)
    if member is None:
        raise ConversationError("Conversation not found", 404)

    other_user: User | None = None
    if conversation.is_group:
        title = conversation.name or "Group"
    else:
        other_user = _direct_counterpart(conversation, viewer_id)
        if other_user is None:
            title = "Unknown"
        elif other_user.id == viewer_id:
            title = "Note to Self"
        else:
            title = (
                _nickname_for(db, viewer_id, other_user.id) or other_user.display_name
            )

    last_message = db.scalars(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
    ).first()

    now = utcnow()
    return ConversationOut(
        id=conversation.id,
        type=conversation.type,
        title=title,
        description=conversation.description,
        avatar_url=conversation.avatar_url
        or (other_user.avatar_url if other_user else None),
        avatar_color=(
            conversation.avatar_color
            if conversation.is_group
            else (other_user.avatar_color if other_user else conversation.avatar_color)
        ),
        disappear_seconds=conversation.disappear_seconds,
        members=[
            MemberOut(
                user=UserPublic.model_validate(m.user),
                role=m.role,
                joined_at=m.joined_at,
            )
            for m in conversation.members
        ],
        other_user=(
            UserPublic.model_validate(other_user)
            if other_user is not None and not conversation.is_group
            else None
        ),
        last_message=(
            message_service.serialize_message(last_message) if last_message else None
        ),
        last_message_at=conversation.last_message_at,
        unread_count=message_service.unread_count(
            db, conversation_id=conversation.id, member=member
        ),
        is_pinned=member.is_pinned,
        is_archived=member.is_archived,
        is_muted=member.muted_until is not None and member.muted_until > now,
        my_role=member.role,
        created_at=conversation.created_at,
    )


def list_for_user(db: Session, user_id: str) -> list[ConversationOut]:
    """Every conversation the user belongs to, ordered as the chat list shows them.

    Pinned first, then by recency. ``last_message_at`` is denormalised onto the
    conversation so this is a plain indexed sort rather than a subquery.
    """
    stmt = (
        select(Conversation)
        .join(ConversationMember)
        .where(ConversationMember.user_id == user_id)
        .options(selectinload(Conversation.members).joinedload(ConversationMember.user))
        .order_by(
            ConversationMember.is_pinned.desc(),
            Conversation.last_message_at.desc().nullslast(),
            Conversation.created_at.desc(),
        )
    )
    return [serialize(db, conversation, user_id) for conversation in db.scalars(stmt)]


# --------------------------------------------------------------------------- #
# Creation
# --------------------------------------------------------------------------- #


def get_or_create_direct(db: Session, user: User, other_user_id: str) -> tuple[Conversation, bool]:
    """Find the one-on-one thread between two people, creating it if absent.

    Idempotent by design: opening a chat from search, from contacts, or by
    deep link must all land on the same conversation rather than forking a new
    one each time. Returns ``(conversation, created)``.
    """
    other = db.get(User, other_user_id)
    if other is None:
        raise ConversationError("User not found", 404)

    is_self_thread = other.id == user.id
    participant_ids = {user.id} if is_self_thread else {user.id, other.id}

    # Match a conversation whose member set is *exactly* `participant_ids`.
    #
    # Both halves are needed. The HAVING alone only counts members that survive
    # the WHERE, so for a one-person Note to Self it would also match the
    # two-person thread with that same person in it. The correlated count pins
    # the total size as well, making the comparison a true set equality.
    total_members = (
        select(func.count())
        .select_from(ConversationMember)
        .where(ConversationMember.conversation_id == Conversation.id)
        .correlate(Conversation)
        .scalar_subquery()
    )

    existing_id = db.scalar(
        select(Conversation.id)
        .join(ConversationMember)
        .where(Conversation.type == ConversationType.DIRECT)
        .where(total_members == len(participant_ids))
        .where(ConversationMember.user_id.in_(participant_ids))
        .group_by(Conversation.id)
        .having(func.count(distinct(ConversationMember.user_id)) == len(participant_ids))
    )
    if existing_id:
        return get_for_user(db, existing_id, user.id), False

    conversation = Conversation(
        type=ConversationType.DIRECT,
        created_by=user.id,
        avatar_color=other.avatar_color,
    )
    db.add(conversation)
    db.flush()

    for participant_id in participant_ids:
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=participant_id,
                role=MemberRole.MEMBER,
            )
        )

    db.commit()
    return get_for_user(db, conversation.id, user.id), True


def create_group(
    db: Session, creator: User, payload: GroupConversationCreate
) -> Conversation:
    """Create a group with the creator as its first admin."""
    member_ids = [uid for uid in payload.member_ids if uid != creator.id]

    found = list(db.scalars(select(User).where(User.id.in_(member_ids))))
    if len(found) != len(set(member_ids)):
        raise ConversationError("One or more members do not exist", 422)

    conversation = Conversation(
        type=ConversationType.GROUP,
        name=payload.name.strip(),
        description=payload.description,
        avatar_url=payload.avatar_url,
        created_by=creator.id,
    )
    db.add(conversation)
    db.flush()
    conversation.avatar_color = colors.color_for(conversation.id)

    db.add(
        ConversationMember(
            conversation_id=conversation.id,
            user_id=creator.id,
            role=MemberRole.ADMIN,
        )
    )
    for user_id in dict.fromkeys(member_ids):
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=user_id,
                role=MemberRole.MEMBER,
            )
        )

    db.commit()
    db.refresh(conversation)

    message_service.create_system_message(
        db,
        conversation=conversation,
        body=f"{creator.display_name} created the group “{conversation.name}”",
    )
    db.refresh(conversation)
    return conversation


# --------------------------------------------------------------------------- #
# Administration
# --------------------------------------------------------------------------- #


def update_group(
    db: Session, conversation: Conversation, actor: User, payload: ConversationUpdate
) -> tuple[Conversation, list[str]]:
    """Apply admin-only group edits. Returns the notices to post as system messages."""
    _require_admin(conversation, actor.id)
    notices: list[str] = []

    if payload.name is not None and payload.name.strip() != conversation.name:
        new_name = payload.name.strip()
        notices.append(
            f"{actor.display_name} changed the group name to “{new_name}”"
        )
        conversation.name = new_name

    if payload.description is not None:
        conversation.description = payload.description or None
    if payload.avatar_url is not None:
        conversation.avatar_url = payload.avatar_url or None

    if (
        payload.disappear_seconds is not None
        and payload.disappear_seconds != conversation.disappear_seconds
    ):
        conversation.disappear_seconds = payload.disappear_seconds
        label = (
            "off"
            if payload.disappear_seconds == 0
            else _format_duration(payload.disappear_seconds)
        )
        notices.append(f"{actor.display_name} set the disappearing message timer to {label}")

    db.commit()
    db.refresh(conversation)
    return conversation, notices


def add_members(
    db: Session, conversation: Conversation, actor: User, user_ids: list[str]
) -> tuple[Conversation, list[str]]:
    _require_admin(conversation, actor.id)

    existing = set(conversation.member_ids())
    to_add = [uid for uid in dict.fromkeys(user_ids) if uid not in existing]
    if not to_add:
        raise ConversationError("Those people are already in the group", 409)

    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(to_add)))}
    if len(users) != len(to_add):
        raise ConversationError("One or more users do not exist", 422)

    for user_id in to_add:
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=user_id,
                role=MemberRole.MEMBER,
            )
        )
    db.commit()
    db.refresh(conversation)

    notices = [
        f"{actor.display_name} added {users[user_id].display_name}" for user_id in to_add
    ]
    return conversation, notices


def remove_member(
    db: Session, conversation: Conversation, actor: User, target_user_id: str
) -> tuple[Conversation, list[str]]:
    """Remove someone, or leave the group when removing yourself."""
    if not conversation.is_group:
        raise ConversationError("You cannot leave a direct conversation", 422)

    actor_member = member_of(conversation, actor.id)
    if actor_member is None:
        raise ConversationError("Conversation not found", 404)

    is_self = target_user_id == actor.id
    if not is_self and not actor_member.is_admin:
        raise ConversationError("Only group admins can remove members", 403)

    target = member_of(conversation, target_user_id)
    if target is None:
        raise ConversationError("That person is not in this group", 404)

    target_name = target.user.display_name
    admin_count = sum(1 for m in conversation.members if m.is_admin)
    was_admin = target.is_admin

    db.delete(target)
    db.flush()

    # Never leave a group adminless: promote the longest-standing remaining member.
    remaining = [m for m in conversation.members if m.user_id != target_user_id]
    if was_admin and admin_count == 1 and remaining:
        successor = min(remaining, key=lambda m: m.joined_at)
        successor.role = MemberRole.ADMIN

    db.commit()
    db.refresh(conversation)

    notices = [
        f"{target_name} left the group"
        if is_self
        else f"{actor.display_name} removed {target_name}"
    ]
    return conversation, notices


def set_member_role(
    db: Session,
    conversation: Conversation,
    actor: User,
    target_user_id: str,
    role: MemberRole,
) -> Conversation:
    _require_admin(conversation, actor.id)

    target = member_of(conversation, target_user_id)
    if target is None:
        raise ConversationError("That person is not in this group", 404)

    if (
        role == MemberRole.MEMBER
        and target.is_admin
        and sum(1 for m in conversation.members if m.is_admin) == 1
    ):
        raise ConversationError("A group needs at least one admin", 422)

    target.role = role
    db.commit()
    db.refresh(conversation)
    return conversation


def update_member_state(
    db: Session, conversation: Conversation, user_id: str, payload: MemberStateUpdate
) -> Conversation:
    """Update the caller's private flags (pin, archive, mute)."""
    member = member_of(conversation, user_id)
    if member is None:
        raise ConversationError("Conversation not found", 404)

    if payload.is_pinned is not None:
        member.is_pinned = payload.is_pinned
    if payload.is_archived is not None:
        member.is_archived = payload.is_archived
    if payload.muted_until is not None:
        member.muted_until = payload.muted_until

    db.commit()
    db.refresh(conversation)
    return conversation


# --------------------------------------------------------------------------- #
# Mocked safety number
# --------------------------------------------------------------------------- #


def safety_number(
    db: Session, conversation: Conversation, viewer_id: str
) -> SafetyNumberOut:
    """The simulated pairwise fingerprint for a direct conversation."""
    if conversation.is_group:
        raise ConversationError("Groups do not have a safety number", 422)

    other = _direct_counterpart(conversation, viewer_id)
    viewer = db.get(User, viewer_id)
    if other is None or viewer is None:
        raise ConversationError("Conversation not found", 404)

    number = mock_crypto.derive_safety_number(viewer.identity_key, other.identity_key)
    return SafetyNumberOut(
        conversation_id=conversation.id,
        safety_number=number,
        groups=mock_crypto.format_safety_number(number),
    )


def _format_duration(seconds: int) -> str:
    for size, label in ((604800, "week"), (86400, "day"), (3600, "hour"), (60, "minute")):
        if seconds >= size and seconds % size == 0:
            count = seconds // size
            return f"{count} {label}{'s' if count != 1 else ''}"
    return f"{seconds} seconds"
