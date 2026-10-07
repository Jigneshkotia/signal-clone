"""Message persistence, receipt bookkeeping, status derivation, and reactions."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.mock_crypto import mock_decrypt, mock_encrypt
from app.models import (
    Conversation,
    ConversationMember,
    Message,
    MessageReceipt,
    MessageStatus,
    MessageType,
    Reaction,
    User,
    utcnow,
)
from app.schemas.message import (
    MessageOut,
    MessagePage,
    QuotedMessage,
    ReactionOut,
    ReceiptOut,
)
from app.schemas.user import UserPublic

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


class MessageError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# --------------------------------------------------------------------------- #
# Status derivation
# --------------------------------------------------------------------------- #


def derive_status(message: Message) -> MessageStatus:
    """Collapse the per-recipient receipt rows into one sender-side status.

    A message is only ``READ`` once every recipient has read it, and only
    ``DELIVERED`` once every recipient has received it -- this is what makes the
    double check behave correctly in a group rather than reflecting whichever
    member happened to reply first.

    With no receipt rows (a solo conversation, or a system message) the message
    is simply ``SENT``: it was accepted, and there is nobody to deliver it to.
    """
    receipts = message.receipts
    if not receipts:
        return MessageStatus.SENT
    if all(receipt.read_at is not None for receipt in receipts):
        return MessageStatus.READ
    if all(receipt.delivered_at is not None for receipt in receipts):
        return MessageStatus.DELIVERED
    return MessageStatus.SENT


def refresh_status(message: Message) -> bool:
    """Recompute and cache ``message.status``. Returns True if it changed."""
    new_status = derive_status(message)
    if message.status != new_status:
        message.status = new_status
        return True
    return False


# --------------------------------------------------------------------------- #
# Serialisation
# --------------------------------------------------------------------------- #


def _quoted(message: Message | None) -> QuotedMessage | None:
    if message is None:
        return None
    sender_name = message.sender.display_name if message.sender else "Unknown"
    return QuotedMessage(
        id=message.id,
        body="" if message.is_deleted else mock_decrypt(message.body),
        sender_id=message.sender_id,
        sender_name=sender_name,
        is_deleted=message.is_deleted,
    )


def serialize_message(message: Message) -> MessageOut:
    """Build the wire form of a message, decrypting the body on the way out."""
    body = "" if message.is_deleted else mock_decrypt(message.body)
    return MessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        sender=UserPublic.model_validate(message.sender) if message.sender else None,
        body=body,
        type=message.type,
        status=message.status,
        client_id=message.client_id,
        created_at=message.created_at,
        edited_at=message.edited_at,
        deleted_at=message.deleted_at,
        reply_to=_quoted(message.reply_to),
        reactions=[
            ReactionOut(
                emoji=reaction.emoji,
                user_id=reaction.user_id,
                created_at=reaction.created_at,
            )
            for reaction in message.reactions
        ],
        receipts=[
            ReceiptOut(
                user_id=receipt.user_id,
                delivered_at=receipt.delivered_at,
                read_at=receipt.read_at,
            )
            for receipt in message.receipts
        ],
    )


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #


def get_message(db: Session, message_id: str) -> Message:
    message = db.get(Message, message_id)
    if message is None:
        raise MessageError("Message not found", 404)
    return message


def get_history(
    db: Session,
    conversation_id: str,
    *,
    before: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> MessagePage:
    """Return one page of history, oldest-first, paginating backwards.

    Keyset pagination on ``created_at`` rather than OFFSET: the timeline grows at
    the end while you scroll up, and an offset would skip or repeat rows as it
    does. ``before`` is a message id whose timestamp anchors the cursor.
    """
    limit = max(1, min(limit, MAX_PAGE_SIZE))

    stmt = select(Message).where(Message.conversation_id == conversation_id)

    if before:
        anchor = db.get(Message, before)
        if anchor is None:
            raise MessageError("Pagination cursor not found", 404)
        # Tie-break on id so messages sharing a timestamp cannot loop forever.
        stmt = stmt.where(
            (Message.created_at < anchor.created_at)
            | ((Message.created_at == anchor.created_at) & (Message.id < anchor.id))
        )

    # Fetch one extra row to detect whether an older page exists.
    stmt = (
        stmt.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit + 1)
    )
    rows = list(db.scalars(stmt))

    has_more = len(rows) > limit
    page = rows[:limit]
    # Reverse into chronological order, which is how the timeline renders.
    page.reverse()

    return MessagePage(
        messages=[serialize_message(message) for message in page],
        has_more=has_more,
        next_cursor=page[0].id if page and has_more else None,
    )


# --------------------------------------------------------------------------- #
# Writes
# --------------------------------------------------------------------------- #


def create_message(
    db: Session,
    *,
    conversation: Conversation,
    sender: User,
    body: str,
    client_id: str | None = None,
    reply_to_id: str | None = None,
) -> tuple[Message, bool]:
    """Persist a message and open a receipt row for every other member.

    Returns ``(message, created)``. When ``client_id`` matches an existing row in
    this conversation the stored message is returned untouched and ``created`` is
    False, which makes sends idempotent under retries and double-submits.
    """
    if client_id:
        existing = db.scalars(
            select(Message).where(
                Message.conversation_id == conversation.id,
                Message.client_id == client_id,
            )
        ).first()
        if existing is not None:
            return existing, False

    if reply_to_id is not None:
        quoted = db.get(Message, reply_to_id)
        if quoted is None or quoted.conversation_id != conversation.id:
            raise MessageError("Cannot reply to a message from another conversation", 422)

    now = utcnow()
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        body=mock_encrypt(body),
        type=MessageType.TEXT,
        reply_to_id=reply_to_id,
        client_id=client_id,
        status=MessageStatus.SENT,
        created_at=now,
    )
    db.add(message)
    db.flush()  # assign message.id before building receipts

    for member in conversation.members:
        if member.user_id == sender.id:
            continue
        db.add(MessageReceipt(message_id=message.id, user_id=member.user_id))

    # Keep the denormalised sort key in step with the newest message.
    conversation.last_message_at = now
    conversation.updated_at = now

    # The sender has, by definition, read their own message.
    sender_member = _member(db, conversation.id, sender.id)
    if sender_member is not None:
        sender_member.last_read_at = now

    db.commit()
    db.refresh(message)
    return message, True


def create_system_message(
    db: Session, *, conversation: Conversation, body: str
) -> Message:
    """Add a centered grey notice such as "Alice added Bob to the group".

    System messages have no sender and no receipts -- nobody needs to acknowledge
    them, and they must never show a delivery tick.
    """
    now = utcnow()
    message = Message(
        conversation_id=conversation.id,
        sender_id=None,
        body=mock_encrypt(body),
        type=MessageType.SYSTEM,
        status=MessageStatus.SENT,
        created_at=now,
    )
    db.add(message)
    conversation.last_message_at = now
    conversation.updated_at = now
    db.commit()
    db.refresh(message)
    return message


def mark_delivered(db: Session, *, user_id: str, message_ids: list[str]) -> list[Message]:
    """Stamp delivery for one recipient. Returns messages whose status changed."""
    if not message_ids:
        return []

    receipts = list(
        db.scalars(
            select(MessageReceipt).where(
                MessageReceipt.user_id == user_id,
                MessageReceipt.message_id.in_(message_ids),
                MessageReceipt.delivered_at.is_(None),
            )
        )
    )
    if not receipts:
        return []

    now = utcnow()
    for receipt in receipts:
        receipt.delivered_at = now
    db.flush()

    changed: list[Message] = []
    for message in _messages_for_receipts(db, receipts):
        if refresh_status(message):
            changed.append(message)

    db.commit()
    return changed


def mark_read(
    db: Session,
    *,
    user_id: str,
    conversation_id: str,
    up_to_message_id: str | None = None,
) -> list[Message]:
    """Mark a conversation read for one member up to a point in its history.

    Also advances ``last_read_at``, which is what zeroes the unread badge.
    Returns the messages whose aggregate status changed, so the caller can tell
    their senders.
    """
    member = _member(db, conversation_id, user_id)
    if member is None:
        raise MessageError("You are not a member of this conversation", 403)

    cutoff: datetime | None = None
    if up_to_message_id:
        anchor = db.get(Message, up_to_message_id)
        if anchor is None or anchor.conversation_id != conversation_id:
            raise MessageError("Message not found in this conversation", 404)
        cutoff = anchor.created_at

    stmt = (
        select(MessageReceipt)
        .join(Message, Message.id == MessageReceipt.message_id)
        .where(
            MessageReceipt.user_id == user_id,
            Message.conversation_id == conversation_id,
            MessageReceipt.read_at.is_(None),
        )
    )
    if cutoff is not None:
        stmt = stmt.where(Message.created_at <= cutoff)

    receipts = list(db.scalars(stmt))

    now = utcnow()
    for receipt in receipts:
        # Opening a chat implies receipt, so backfill delivery if it is missing.
        if receipt.delivered_at is None:
            receipt.delivered_at = now
        receipt.read_at = now

    member.last_read_at = cutoff or now
    db.flush()

    changed: list[Message] = []
    for message in _messages_for_receipts(db, receipts):
        if refresh_status(message):
            changed.append(message)

    db.commit()
    return changed


def set_reaction(
    db: Session, *, message: Message, user_id: str, emoji: str | None
) -> Message:
    """Set, replace, or clear the caller's reaction on a message.

    One reaction per person per message, matching Signal: reacting again with a
    different emoji replaces, and reacting with the same emoji toggles it off.
    """
    existing = db.scalars(
        select(Reaction).where(
            Reaction.message_id == message.id, Reaction.user_id == user_id
        )
    ).first()

    if emoji is None or (existing is not None and existing.emoji == emoji):
        if existing is not None:
            db.delete(existing)
    elif existing is not None:
        existing.emoji = emoji
        existing.created_at = utcnow()
    else:
        db.add(Reaction(message_id=message.id, user_id=user_id, emoji=emoji))

    db.commit()
    db.refresh(message)
    return message


def soft_delete(db: Session, *, message: Message, user_id: str) -> Message:
    """Mark a message deleted for everyone. Only the sender may do this."""
    if message.sender_id != user_id:
        raise MessageError("You can only delete your own messages", 403)
    if message.is_deleted:
        return message

    message.deleted_at = utcnow()
    message.body = mock_encrypt("")
    db.commit()
    db.refresh(message)
    return message


def unread_count(db: Session, *, conversation_id: str, member: ConversationMember) -> int:
    """Messages from other people newer than this member's read watermark."""
    from sqlalchemy import func

    stmt = (
        select(func.count())
        .select_from(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.deleted_at.is_(None),
            Message.type == MessageType.TEXT,
            Message.sender_id != member.user_id,
        )
    )
    if member.last_read_at is not None:
        stmt = stmt.where(Message.created_at > member.last_read_at)
    return db.scalar(stmt) or 0


def undelivered_message_ids(db: Session, *, user_id: str) -> list[str]:
    """Messages awaiting delivery for a user -- used when their socket connects."""
    stmt = select(MessageReceipt.message_id).where(
        MessageReceipt.user_id == user_id,
        MessageReceipt.delivered_at.is_(None),
    )
    return list(db.scalars(stmt))


# --------------------------------------------------------------------------- #
# Internals
# --------------------------------------------------------------------------- #


def _member(db: Session, conversation_id: str, user_id: str) -> ConversationMember | None:
    return db.scalars(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    ).first()


def _messages_for_receipts(
    db: Session, receipts: list[MessageReceipt]
) -> list[Message]:
    """Load the distinct messages behind a batch of receipts in one query."""
    message_ids = {receipt.message_id for receipt in receipts}
    if not message_ids:
        return []
    return list(db.scalars(select(Message).where(Message.id.in_(message_ids))))
