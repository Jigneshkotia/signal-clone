"""Conversation listing, creation, and group administration.

Routes stay synchronous so SQLAlchemy runs on the thread pool FastAPI already
provides. Live fan-out is scheduled with ``BackgroundTasks``, which accepts async
callables and runs them once the response has been sent -- so an admin action
returns immediately and the WebSocket broadcast happens just after.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, DbSession
from app.models import Conversation, MemberRole, Message
from app.realtime import router as ws
from app.schemas.conversation import (
    ConversationOut,
    ConversationUpdate,
    DirectConversationCreate,
    GroupConversationCreate,
    MemberAdd,
    MemberStateUpdate,
)
from app.schemas.user import SafetyNumberOut
from app.services import conversation_service, message_service

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _http(exc: conversation_service.ConversationError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


def _post_notices(
    db: Session, conversation: Conversation, notices: list[str]
) -> list[Message]:
    """Persist the system messages describing an administrative change."""
    return [
        message_service.create_system_message(db, conversation=conversation, body=notice)
        for notice in notices
    ]


def _schedule_fanout(
    background: BackgroundTasks,
    conversation: Conversation,
    system_messages: list[Message],
    extra_recipient_ids: list[str] | None = None,
) -> None:
    """Broadcast system messages, then a refreshed conversation, to all members.

    ``extra_recipient_ids`` carries people who were just removed, so they also
    learn the conversation is gone.
    """
    member_ids = conversation.member_ids()
    recipients = list(dict.fromkeys(member_ids + (extra_recipient_ids or [])))

    for message in system_messages:
        payload = message_service.serialize_message(message).model_dump(mode="json")
        background.add_task(ws.broadcast_new_message, payload, member_ids)

    background.add_task(ws.broadcast_conversation_update, conversation.id, recipients)


# --------------------------------------------------------------------------- #
# Listing and creation
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[ConversationOut])
def list_conversations(current_user: CurrentUser, db: DbSession) -> list[ConversationOut]:
    """Every conversation for the caller, pinned first then by recency."""
    return conversation_service.list_for_user(db, current_user.id)


@router.post("/direct", response_model=ConversationOut)
def create_direct(
    payload: DirectConversationCreate, current_user: CurrentUser, db: DbSession
) -> ConversationOut:
    """Open the one-on-one thread with someone, creating it only if needed.

    Idempotent, so opening the same chat twice never forks a second thread.
    """
    try:
        conversation, _created = conversation_service.get_or_create_direct(
            db, current_user, payload.user_id
        )
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc
    return conversation_service.serialize(db, conversation, current_user.id)


@router.post(
    "/group", response_model=ConversationOut, status_code=status.HTTP_201_CREATED
)
def create_group(
    payload: GroupConversationCreate,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> ConversationOut:
    try:
        conversation = conversation_service.create_group(db, current_user, payload)
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc

    # Everyone added needs to see the new group appear in their chat list.
    background.add_task(
        ws.broadcast_conversation_update, conversation.id, conversation.member_ids()
    )
    return conversation_service.serialize(db, conversation, current_user.id)


@router.get("/{conversation_id}", response_model=ConversationOut)
def get_conversation(
    conversation_id: str, current_user: CurrentUser, db: DbSession
) -> ConversationOut:
    try:
        conversation = conversation_service.get_for_user(
            db, conversation_id, current_user.id
        )
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc
    return conversation_service.serialize(db, conversation, current_user.id)


# --------------------------------------------------------------------------- #
# Group administration
# --------------------------------------------------------------------------- #


@router.patch("/{conversation_id}", response_model=ConversationOut)
def update_conversation(
    conversation_id: str,
    payload: ConversationUpdate,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> ConversationOut:
    """Rename a group, edit its description, or set the disappearing timer."""
    try:
        conversation = conversation_service.get_for_user(
            db, conversation_id, current_user.id
        )
        conversation, notices = conversation_service.update_group(
            db, conversation, current_user, payload
        )
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc

    _schedule_fanout(background, conversation, _post_notices(db, conversation, notices))
    return conversation_service.serialize(db, conversation, current_user.id)


@router.post("/{conversation_id}/members", response_model=ConversationOut)
def add_members(
    conversation_id: str,
    payload: MemberAdd,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> ConversationOut:
    try:
        conversation = conversation_service.get_for_user(
            db, conversation_id, current_user.id
        )
        conversation, notices = conversation_service.add_members(
            db, conversation, current_user, payload.user_ids
        )
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc

    _schedule_fanout(background, conversation, _post_notices(db, conversation, notices))
    return conversation_service.serialize(db, conversation, current_user.id)


@router.delete("/{conversation_id}/members/{user_id}", response_model=ConversationOut)
def remove_member(
    conversation_id: str,
    user_id: str,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> ConversationOut:
    """Remove a member as an admin, or pass your own id to leave the group."""
    try:
        conversation = conversation_service.get_for_user(
            db, conversation_id, current_user.id
        )
        conversation, notices = conversation_service.remove_member(
            db, conversation, current_user, user_id
        )
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc

    _schedule_fanout(
        background,
        conversation,
        _post_notices(db, conversation, notices),
        extra_recipient_ids=[user_id],
    )

    if user_id == current_user.id:
        # The caller is no longer a member, so there is nothing to serialise.
        return ConversationOut(
            id=conversation.id,
            type=conversation.type,
            title=conversation.name or "Group",
            avatar_color=conversation.avatar_color,
            created_at=conversation.created_at,
        )
    return conversation_service.serialize(db, conversation, current_user.id)


@router.patch("/{conversation_id}/members/{user_id}/role", response_model=ConversationOut)
def set_member_role(
    conversation_id: str,
    user_id: str,
    role: MemberRole,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> ConversationOut:
    """Promote a member to admin, or demote one back to member."""
    try:
        conversation = conversation_service.get_for_user(
            db, conversation_id, current_user.id
        )
        conversation = conversation_service.set_member_role(
            db, conversation, current_user, user_id, role
        )
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc

    background.add_task(
        ws.broadcast_conversation_update, conversation.id, conversation.member_ids()
    )
    return conversation_service.serialize(db, conversation, current_user.id)


# --------------------------------------------------------------------------- #
# Per-viewer state and the mocked safety number
# --------------------------------------------------------------------------- #


@router.patch("/{conversation_id}/state", response_model=ConversationOut)
def update_member_state(
    conversation_id: str,
    payload: MemberStateUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> ConversationOut:
    """Pin, archive, or mute -- private to the caller, so nothing is broadcast."""
    try:
        conversation = conversation_service.get_for_user(
            db, conversation_id, current_user.id
        )
        conversation = conversation_service.update_member_state(
            db, conversation, current_user.id, payload
        )
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc
    return conversation_service.serialize(db, conversation, current_user.id)


@router.get("/{conversation_id}/safety-number", response_model=SafetyNumberOut)
def get_safety_number(
    conversation_id: str, current_user: CurrentUser, db: DbSession
) -> SafetyNumberOut:
    """The simulated pairwise fingerprint. See core/mock_crypto.py."""
    try:
        conversation = conversation_service.get_for_user(
            db, conversation_id, current_user.id
        )
        return conversation_service.safety_number(db, conversation, current_user.id)
    except conversation_service.ConversationError as exc:
        raise _http(exc) from exc
