"""WebSocket frame envelopes.

Every frame in both directions is ``{"type": ..., "payload": {...}}``. The event
names live in :mod:`app.realtime.events`; these models only describe the shape of
the client-to-server payloads so the dispatcher can validate them.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class WsEnvelope(BaseModel):
    type: str
    payload: dict = Field(default_factory=dict)


class WsSendMessage(BaseModel):
    conversation_id: str
    body: str = Field(min_length=1, max_length=8000)
    client_id: str | None = Field(default=None, max_length=36)
    reply_to_id: str | None = None


class WsTyping(BaseModel):
    conversation_id: str


class WsReadReceipt(BaseModel):
    conversation_id: str
    up_to_message_id: str | None = None


class WsReaction(BaseModel):
    message_id: str
    emoji: str | None = Field(default=None, max_length=16)
