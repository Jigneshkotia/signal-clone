"""Shared column helpers and the enums used across the schema."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator


def new_id() -> str:
    """Primary keys are UUID4 strings so clients can reference rows without a round trip."""
    return str(uuid.uuid4())


def utcnow() -> datetime:
    """Timezone-aware UTC. Never use ``datetime.utcnow()`` -- it returns a naive value."""
    return datetime.now(timezone.utc)


class UtcDateTime(TypeDecorator):
    """A datetime column that is always UTC and always timezone-aware in Python.

    SQLite has no native timestamp type: it stores whatever string SQLAlchemy
    hands it and silently drops ``tzinfo``. Left alone, a value written as
    ``12:00+00:00`` reads back naive, serialises as ``"12:00"`` with no offset,
    and ``new Date()`` in the browser then parses it as *local* time -- shifting
    every message timestamp by the viewer's UTC offset.

    So normalise at the boundary: convert to UTC and strip the offset on the way
    in, re-attach UTC on the way out. Callers only ever see aware datetimes, and
    the JSON always carries a ``+00:00``.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(
        self, value: datetime | None, dialect: Dialect
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            # Assume naive input is already UTC rather than guessing a zone.
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(
        self, value: datetime | None, dialect: Dialect
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class ConversationType(enum.StrEnum):
    DIRECT = "direct"
    GROUP = "group"


class MemberRole(enum.StrEnum):
    ADMIN = "admin"
    MEMBER = "member"


class MessageType(enum.StrEnum):
    TEXT = "text"
    # System rows render as centered grey text: "Alice added Bob to the group".
    SYSTEM = "system"


class MessageStatus(enum.StrEnum):
    """Sender-side aggregate, derived from the per-recipient ``message_receipts`` rows.

    ``SENDING`` only ever exists optimistically on the client; the server never
    persists it, because a row existing at all means the message was accepted.
    """

    SENDING = "sending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
