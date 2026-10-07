"""Message, receipt, and reaction payloads."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.common import MessageStatus, MessageType
from app.schemas.user import UserPublic


class ReceiptOut(BaseModel):
    """Per-recipient delivery state, shown in the message-details panel."""

    model_config = ConfigDict(from_attributes=True)

    user_id: str
    delivered_at: datetime | None = None
    read_at: datetime | None = None


class ReactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    emoji: str
    user_id: str
    created_at: datetime


class QuotedMessage(BaseModel):
    """The trimmed form of a message when it is quoted by a reply."""

    id: str
    body: str
    sender_id: str | None = None
    sender_name: str
    is_deleted: bool = False


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    sender_id: str | None = None
    sender: UserPublic | None = None
    body: str
    type: MessageType
    status: MessageStatus
    client_id: str | None = None
    created_at: datetime
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    reply_to: QuotedMessage | None = None
    reactions: list[ReactionOut] = Field(default_factory=list)
    receipts: list[ReceiptOut] = Field(default_factory=list)


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    # Supplied by the client so an optimistic bubble can be reconciled with the
    # persisted row, and so a retry does not create a duplicate.
    client_id: str | None = Field(default=None, max_length=36)
    reply_to_id: str | None = None


class MessagePage(BaseModel):
    """One page of history, newest-last, with a cursor for the page before it."""

    messages: list[MessageOut]
    has_more: bool
    # Pass back as `before` to fetch older messages.
    next_cursor: str | None = None


class ReactionSet(BaseModel):
    """``emoji: null`` removes the caller's existing reaction."""

    emoji: str | None = Field(default=None, max_length=16)


class ReadReceiptRequest(BaseModel):
    """Mark everything up to and including this message as read."""

    up_to_message_id: str | None = None
