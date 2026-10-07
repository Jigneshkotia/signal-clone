"""Messages, per-recipient receipts, and emoji reactions."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.common import (
    MessageStatus,
    MessageType,
    UtcDateTime,
    new_id,
    utcnow,
)

if TYPE_CHECKING:
    from app.models.conversation import Conversation
    from app.models.user import User


class Message(Base):
    """A single message in a conversation."""

    __tablename__ = "messages"
    __table_args__ = (
        # The timeline query is always "newest N in this conversation, before X",
        # so this composite index is what keeps history pagination a range scan.
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
        UniqueConstraint("conversation_id", "client_id", name="uq_message_client_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )

    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    type: Mapped[MessageType] = mapped_column(
        Enum(MessageType, native_enum=False, length=16),
        nullable=False,
        default=MessageType.TEXT,
    )

    # Self-referential: powers Signal's quoted replies. SET NULL rather than
    # CASCADE so deleting a quoted message does not delete every reply to it.
    reply_to_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), index=True
    )

    # Cached aggregate over `receipts`; see services/message_service.py for the
    # derivation. Stored so rendering the chat list never fans out into receipts.
    status: Mapped[MessageStatus] = mapped_column(
        Enum(MessageStatus, native_enum=False, length=16),
        nullable=False,
        default=MessageStatus.SENT,
    )

    # Client-generated UUID. Unique per conversation so a retried or
    # double-submitted optimistic send resolves to the same row instead of a
    # duplicate, and so the client can match the ack to its pending bubble.
    client_id: Mapped[str | None] = mapped_column(String(36))

    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow, index=True
    )
    edited_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    # Soft delete: the row survives so the bubble can render "This message was
    # deleted" in everyone's timeline, exactly as Signal does.
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    sender: Mapped["User | None"] = relationship(lazy="joined")
    reply_to: Mapped["Message | None"] = relationship(remote_side=[id], lazy="joined")

    receipts: Mapped[list["MessageReceipt"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", lazy="selectin"
    )
    reactions: Mapped[list["Reaction"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Message {self.id[:8]} {self.body[:24]!r}>"


class MessageReceipt(Base):
    """Per-recipient delivery and read state.

    This table is why group receipts are correct. Signal only fills the double
    check once *every* recipient has read, which a single column on `messages`
    cannot express. One row per (message, recipient); the sender gets no row.
    """

    __tablename__ = "message_receipts"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_receipt_pair"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # NULL means "not yet". Timestamps rather than booleans so the UI can show
    # exact delivery/read times in the message-details panel.
    delivered_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    read_at: Mapped[datetime | None] = mapped_column(UtcDateTime)

    message: Mapped["Message"] = relationship(back_populates="receipts")
    user: Mapped["User"] = relationship(lazy="joined")


class Reaction(Base):
    """An emoji reaction. One per user per message -- re-reacting replaces."""

    __tablename__ = "reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_reaction_pair"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow
    )

    message: Mapped["Message"] = relationship(back_populates="reactions")
    user: Mapped["User"] = relationship(lazy="joined")
