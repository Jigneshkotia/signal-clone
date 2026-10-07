"""The WebSocket event vocabulary, shared by both directions.

Frames are always ``{"type": <Event>, "payload": {...}}``. The frontend mirrors
this list in ``src/lib/socket.ts``; keep the two in sync.
"""

from __future__ import annotations

import enum
from typing import Any


class ClientEvent(enum.StrEnum):
    """Frames the browser sends."""

    SEND_MESSAGE = "message.send"
    TYPING_START = "typing.start"
    TYPING_STOP = "typing.stop"
    READ_RECEIPT = "receipt.read"
    SET_REACTION = "reaction.set"
    PING = "ping"


class ServerEvent(enum.StrEnum):
    """Frames the server sends."""

    READY = "ready"
    NEW_MESSAGE = "message.new"
    MESSAGE_STATUS = "message.status"
    TYPING = "typing"
    PRESENCE = "presence"
    REACTION_UPDATE = "reaction.update"
    CONVERSATION_UPDATE = "conversation.update"
    ERROR = "error"
    PONG = "pong"


def frame(event: ServerEvent, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build an outbound frame."""
    return {"type": str(event), "payload": payload or {}}


def error_frame(message: str, *, code: str = "bad_request") -> dict[str, Any]:
    return frame(ServerEvent.ERROR, {"code": code, "message": message})
