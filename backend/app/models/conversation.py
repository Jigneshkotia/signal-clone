"""Conversations (direct and group) and per-user membership state."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.common import (
    ConversationType,
    MemberRole,
    UtcDateTime,
    new_id,
    utcnow,
)

if TYPE_CHECKING:
    from app.models.message import Message
    from app.models.user import User


class Conversation(Base):
    """A direct (two-person) or group thread.

    Both kinds share one table because every downstream feature -- messages,
    receipts, typing, reactions -- treats them identically. Only the header UI
    and the admin controls branch on ``type``.
    """

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    type: Mapped[ConversationType] = mapped_column(
        Enum(ConversationType, native_enum=False, length=16), nullable=False
    )

    # Groups only; a direct conversation is titled from the other participant.
    name: Mapped[str | None] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(String(512))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    avatar_color: Mapped[str] = mapped_column(String(24), nullable=False, default="steel")

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    # Disappearing-message timer in seconds; 0 means off. Surfaced in the UI but
    # not enforced server-side (see README: out of scope for this build).
    disappear_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow, onupdate=utcnow
    )
    # Denormalised from the newest message so the chat list sorts with a plain
    # ORDER BY instead of a correlated subquery over `messages` on every load.
    last_message_at: Mapped[datetime | None] = mapped_column(
        UtcDateTime, index=True
    )

    members: Mapped[list["ConversationMember"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )

    @property
    def is_group(self) -> bool:
        return self.type == ConversationType.GROUP

    def member_ids(self) -> list[str]:
        return [member.user_id for member in self.members]

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Conversation {self.type} {self.name or self.id[:8]!r}>"


class ConversationMember(Base):
    """Join row carrying each participant's private view of a conversation.

    ``last_read_at`` is a timestamp rather than a ``last_read_message_id`` foreign
    key on purpose: an FK here would close a cycle
    (conversations -> members -> messages -> conversations) that SQLite cannot
    resolve, since it has no ``ALTER TABLE ADD CONSTRAINT``. A timestamp also makes
    the unread count a single indexed range scan.
    """

    __tablename__ = "conversation_members"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_conversation_member"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    role: Mapped[MemberRole] = mapped_column(
        Enum(MemberRole, native_enum=False, length=16),
        nullable=False,
        default=MemberRole.MEMBER,
    )
    joined_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow
    )

    # Everything below is per-member and never visible to other participants.
    last_read_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    muted_until: Mapped[datetime | None] = mapped_column(UtcDateTime)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    conversation: Mapped["Conversation"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships", lazy="joined")

    @property
    def is_admin(self) -> bool:
        return self.role == MemberRole.ADMIN
