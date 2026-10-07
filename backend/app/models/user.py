"""User accounts and the directional contact address book."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.common import UtcDateTime, new_id, utcnow

if TYPE_CHECKING:
    from app.models.conversation import ConversationMember


class User(Base):
    """A registered account.

    Signal identifies people by phone number but also supports usernames, so both
    are optional-but-unique and registration requires at least one (enforced in
    the service layer, since SQLite cannot express that as a table constraint).
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)

    phone_number: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)

    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    about: Mapped[str | None] = mapped_column(String(256))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    # One of the twelve Signal conversation colors; see core/colors.py.
    avatar_color: Mapped[str] = mapped_column(String(24), nullable=False, default="ultramarine")

    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)

    # Mocked E2EE identity. The pairwise safety number is derived from two of
    # these on demand rather than stored -- see core/mock_crypto.py.
    identity_key: Mapped[str] = mapped_column(String(64), nullable=False)

    is_online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow
    )

    memberships: Mapped[list["ConversationMember"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    contacts: Mapped[list["Contact"]] = relationship(
        back_populates="owner",
        foreign_keys="Contact.owner_id",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User {self.display_name!r} {self.id[:8]}>"


class Contact(Base):
    """A directional address-book entry.

    Deliberately one-way: A saving B does not make B a contact of A, which mirrors
    how a real address book behaves and keeps "add contact" from leaking your
    existence into someone else's list.
    """

    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("owner_id", "contact_user_id", name="uq_contact_pair"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contact_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Lets you file someone under your own name for them, as Signal allows.
    nickname: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow
    )

    owner: Mapped["User"] = relationship(back_populates="contacts", foreign_keys=[owner_id])
    contact_user: Mapped["User"] = relationship(foreign_keys=[contact_user_id])
