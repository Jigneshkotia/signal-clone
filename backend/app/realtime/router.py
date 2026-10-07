"""The ``/ws`` endpoint: authentication, dispatch, and presence lifecycle.

Database work is synchronous SQLAlchemy, so every handler runs inside
``run_in_threadpool`` to keep the event loop free. Handlers are plain functions
that take a ``Session`` and return a list of ``(recipient_ids, frame)`` pairs;
the async layer owns all the socket writes. That split keeps the DB logic
testable without a running event loop and makes the fan-out easy to follow.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.security import TokenError, decode_access_token
from app.database import SessionLocal
from app.models import User
from app.realtime.connection_manager import manager
from app.realtime.events import ClientEvent, ServerEvent, error_frame, frame
from app.schemas.ws import (
    WsEnvelope,
    WsReaction,
    WsReadReceipt,
    WsSendMessage,
    WsTyping,
)
from app.services import conversation_service, message_service, presence_service

logger = logging.getLogger(__name__)

router = APIRouter()

# (recipient user ids, frame to deliver)
Outbound = tuple[list[str], dict[str, Any]]

WS_POLICY_VIOLATION = 1008


def _with_session[T](fn: Callable[[Session], T]) -> T:
    """Run ``fn`` against a fresh short-lived session.

    WebSocket connections outlive any sensible transaction, so a session is
    opened per frame rather than per connection.
    """
    with SessionLocal() as db:
        return fn(db)


async def _db(fn: Callable[[Session], Any]) -> Any:
    return await run_in_threadpool(_with_session, fn)


# --------------------------------------------------------------------------- #
# Endpoint
# --------------------------------------------------------------------------- #


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(..., description="JWT access token"),
) -> None:
    """One socket per browser tab, carrying every live event for that user.

    The token arrives as a query parameter because the browser ``WebSocket`` API
    cannot set request headers.
    """
    try:
        user_id = decode_access_token(token)
    except TokenError:
        # Reject before accepting so the browser surfaces a failed handshake.
        await websocket.close(code=WS_POLICY_VIOLATION, reason="Invalid token")
        return

    user = await _db(lambda db: db.get(User, user_id))
    if user is None:
        await websocket.close(code=WS_POLICY_VIOLATION, reason="Unknown user")
        return

    await websocket.accept()
    became_online = await manager.connect(user_id, websocket)

    try:
        if became_online:
            await _announce_presence(user_id, is_online=True)
        await websocket.send_json(
            frame(ServerEvent.READY, {"user_id": user_id})
        )
        # Anything that arrived while this user was away is now delivered.
        await _flush_pending_delivery(user_id)

        await _receive_loop(websocket, user_id)

    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - never let one socket take down the server
        logger.exception("WebSocket error for user %s", user_id)
    finally:
        went_offline = await manager.disconnect(user_id, websocket)
        if went_offline:
            await _announce_presence(user_id, is_online=False)


async def _receive_loop(websocket: WebSocket, user_id: str) -> None:
    while True:
        raw = await websocket.receive_json()

        try:
            envelope = WsEnvelope.model_validate(raw)
        except ValidationError:
            await websocket.send_json(error_frame("Malformed frame"))
            continue

        try:
            outbound = await _dispatch(user_id, envelope)
        except (
            conversation_service.ConversationError,
            message_service.MessageError,
        ) as exc:
            await websocket.send_json(error_frame(exc.message))
            continue
        except ValidationError as exc:
            await websocket.send_json(error_frame(_first_error(exc)))
            continue

        for recipients, payload in outbound:
            await manager.send_to_users(recipients, payload)


async def _dispatch(user_id: str, envelope: WsEnvelope) -> list[Outbound]:
    """Route one client frame to its handler."""
    match envelope.type:
        case ClientEvent.PING:
            return [([user_id], frame(ServerEvent.PONG))]

        case ClientEvent.SEND_MESSAGE:
            payload = WsSendMessage.model_validate(envelope.payload)
            return await _handle_send_message(user_id, payload)

        case ClientEvent.TYPING_START | ClientEvent.TYPING_STOP:
            payload = WsTyping.model_validate(envelope.payload)
            is_typing = envelope.type == ClientEvent.TYPING_START
            return await _handle_typing(user_id, payload, is_typing=is_typing)

        case ClientEvent.READ_RECEIPT:
            payload = WsReadReceipt.model_validate(envelope.payload)
            return await _handle_read_receipt(user_id, payload)

        case ClientEvent.SET_REACTION:
            payload = WsReaction.model_validate(envelope.payload)
            return await _handle_reaction(user_id, payload)

        case _:
            return [([user_id], error_frame(f"Unknown event {envelope.type!r}"))]


# --------------------------------------------------------------------------- #
# Handlers
# --------------------------------------------------------------------------- #


async def _handle_send_message(
    user_id: str, payload: WsSendMessage
) -> list[Outbound]:
    def work(db: Session) -> tuple[list[str], dict[str, Any], str]:
        conversation = conversation_service.get_for_user(
            db, payload.conversation_id, user_id
        )
        sender = db.get(User, user_id)
        assert sender is not None  # guaranteed by the handshake

        message, _created = message_service.create_message(
            db,
            conversation=conversation,
            sender=sender,
            body=payload.body,
            client_id=payload.client_id,
            reply_to_id=payload.reply_to_id,
        )
        serialized = message_service.serialize_message(message)
        return conversation.member_ids(), serialized.model_dump(mode="json"), message.id

    member_ids, message_json, message_id = await run_in_threadpool(_with_session, work)

    # Every member gets the message, the sender included, so a second tab stays
    # in step and the optimistic bubble is reconciled by its client_id.
    actions: list[Outbound] = [
        (member_ids, frame(ServerEvent.NEW_MESSAGE, {"message": message_json}))
    ]

    # Anyone currently connected has, by definition, received it.
    connected = [
        uid for uid in member_ids if uid != user_id and manager.is_online(uid)
    ]
    for recipient_id in connected:
        changed = await run_in_threadpool(
            _with_session,
            lambda db, rid=recipient_id: message_service.mark_delivered(
                db, user_id=rid, message_ids=[message_id]
            ),
        )
        actions.extend(_status_frames(changed, member_ids))

    return actions


async def _handle_typing(
    user_id: str, payload: WsTyping, *, is_typing: bool
) -> list[Outbound]:
    """Typing is ephemeral -- broadcast only, never persisted."""

    def work(db: Session) -> list[str]:
        conversation = conversation_service.get_for_user(
            db, payload.conversation_id, user_id
        )
        return conversation.member_ids()

    member_ids = await run_in_threadpool(_with_session, work)
    recipients = [uid for uid in member_ids if uid != user_id]
    return [
        (
            recipients,
            frame(
                ServerEvent.TYPING,
                {
                    "conversation_id": payload.conversation_id,
                    "user_id": user_id,
                    "is_typing": is_typing,
                },
            ),
        )
    ]


async def _handle_read_receipt(
    user_id: str, payload: WsReadReceipt
) -> list[Outbound]:
    def work(db: Session) -> tuple[list[str], list[dict[str, Any]]]:
        conversation = conversation_service.get_for_user(
            db, payload.conversation_id, user_id
        )
        changed = message_service.mark_read(
            db,
            user_id=user_id,
            conversation_id=payload.conversation_id,
            up_to_message_id=payload.up_to_message_id,
        )
        return conversation.member_ids(), [
            {
                "message_id": message.id,
                "status": str(message.status),
                "sender_id": message.sender_id,
            }
            for message in changed
        ]

    member_ids, updates = await run_in_threadpool(_with_session, work)

    # Only the sender needs to see their own tick change.
    actions: list[Outbound] = []
    for update in updates:
        sender_id = update.pop("sender_id")
        if sender_id:
            actions.append(
                ([sender_id], frame(ServerEvent.MESSAGE_STATUS, update))
            )

    # Tell the reader's other tabs to clear the unread badge.
    actions.append(
        (
            [user_id],
            frame(
                ServerEvent.MESSAGE_STATUS,
                {
                    "conversation_id": payload.conversation_id,
                    "read_cleared": True,
                },
            ),
        )
    )
    _ = member_ids
    return actions


async def _handle_reaction(user_id: str, payload: WsReaction) -> list[Outbound]:
    def work(db: Session) -> tuple[list[str], dict[str, Any]]:
        message = message_service.get_message(db, payload.message_id)
        # Reuse the membership gate so you cannot react into a conversation
        # you are not part of.
        conversation = conversation_service.get_for_user(
            db, message.conversation_id, user_id
        )
        updated = message_service.set_reaction(
            db, message=message, user_id=user_id, emoji=payload.emoji
        )
        return conversation.member_ids(), {
            "message_id": updated.id,
            "conversation_id": updated.conversation_id,
            "reactions": [
                {
                    "emoji": reaction.emoji,
                    "user_id": reaction.user_id,
                    "created_at": reaction.created_at.isoformat(),
                }
                for reaction in updated.reactions
            ],
        }

    member_ids, reaction_payload = await run_in_threadpool(_with_session, work)
    return [(member_ids, frame(ServerEvent.REACTION_UPDATE, reaction_payload))]


# --------------------------------------------------------------------------- #
# Presence and delivery helpers
# --------------------------------------------------------------------------- #


async def _announce_presence(user_id: str, *, is_online: bool) -> None:
    """Persist a presence change and tell everyone who shares a conversation."""

    def work(db: Session) -> tuple[list[str], dict[str, Any]]:
        user = (
            presence_service.mark_online(db, user_id)
            if is_online
            else presence_service.mark_offline(db, user_id)
        )
        peers = presence_service.peer_ids(db, user_id)
        return peers, {
            "user_id": user_id,
            "is_online": is_online,
            "last_seen_at": (
                user.last_seen_at.isoformat() if user and user.last_seen_at else None
            ),
        }

    peers, payload = await run_in_threadpool(_with_session, work)
    await manager.send_to_users(peers, frame(ServerEvent.PRESENCE, payload))


async def _flush_pending_delivery(user_id: str) -> None:
    """On connect, deliver everything that queued up while the user was away."""

    def work(db: Session) -> list[dict[str, Any]]:
        pending = message_service.undelivered_message_ids(db, user_id=user_id)
        if not pending:
            return []
        changed = message_service.mark_delivered(
            db, user_id=user_id, message_ids=pending
        )
        return [
            {
                "message_id": message.id,
                "status": str(message.status),
                "sender_id": message.sender_id,
            }
            for message in changed
        ]

    updates = await run_in_threadpool(_with_session, work)
    for update in updates:
        sender_id = update.pop("sender_id")
        if sender_id:
            await manager.send_to_user(
                sender_id, frame(ServerEvent.MESSAGE_STATUS, update)
            )


def _status_frames(changed: list[Any], member_ids: list[str]) -> list[Outbound]:
    """Build status frames for messages whose aggregate status moved."""
    actions: list[Outbound] = []
    for message in changed:
        if not message.sender_id:
            continue
        actions.append(
            (
                [message.sender_id],
                frame(
                    ServerEvent.MESSAGE_STATUS,
                    {
                        "message_id": message.id,
                        "conversation_id": message.conversation_id,
                        "status": str(message.status),
                    },
                ),
            )
        )
    _ = member_ids
    return actions


def _first_error(exc: ValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "Invalid payload"
    first = errors[0]
    location = ".".join(str(part) for part in first.get("loc", ()))
    return f"{location}: {first.get('msg', 'invalid')}".strip(": ")


async def broadcast_conversation_update(
    conversation_id: str, recipient_ids: list[str]
) -> None:
    """Push a refreshed conversation to each member, serialised per viewer.

    Called from the REST routes after group metadata or membership changes.
    Conversations render differently for different viewers (title, unread, role),
    so each recipient gets their own serialisation rather than a shared payload.
    """
    for recipient_id in recipient_ids:
        if not manager.is_online(recipient_id):
            continue

        def work(db: Session, rid: str = recipient_id) -> dict[str, Any] | None:
            try:
                conversation = conversation_service.get_for_user(
                    db, conversation_id, rid
                )
            except conversation_service.ConversationError:
                # Just removed from the group: tell them it is gone.
                return None
            return conversation_service.serialize(db, conversation, rid).model_dump(
                mode="json"
            )

        payload = await run_in_threadpool(_with_session, work)
        if payload is None:
            await manager.send_to_user(
                recipient_id,
                frame(
                    ServerEvent.CONVERSATION_UPDATE,
                    {"conversation_id": conversation_id, "removed": True},
                ),
            )
        else:
            await manager.send_to_user(
                recipient_id,
                frame(ServerEvent.CONVERSATION_UPDATE, {"conversation": payload}),
            )


async def broadcast_new_message(message_json: dict[str, Any], member_ids: list[str]) -> None:
    """Push a message to a conversation's members. Used by the REST send fallback."""
    await manager.send_to_users(
        member_ids, frame(ServerEvent.NEW_MESSAGE, {"message": message_json})
    )
