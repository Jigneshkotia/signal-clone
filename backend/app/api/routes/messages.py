"""Message history, the REST send fallback, read receipts, and reactions.

The WebSocket is the primary transport for sending. These endpoints exist so the
API is complete and usable without a socket (and so history pagination, which is
a request/response concern, is not awkwardly bolted onto the socket protocol).
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession
from app.realtime import router as ws
from app.realtime.connection_manager import manager
from app.schemas.message import (
    MessageCreate,
    MessageOut,
    MessagePage,
    ReactionSet,
    ReadReceiptRequest,
)
from app.services import conversation_service, message_service

router = APIRouter(tags=["messages"])


def _http(
    exc: conversation_service.ConversationError | message_service.MessageError,
) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


# --------------------------------------------------------------------------- #
# History
# --------------------------------------------------------------------------- #


@router.get("/conversations/{conversation_id}/messages", response_model=MessagePage)
def get_messages(
    conversation_id: str,
    current_user: CurrentUser,
    db: DbSession,
    before: str | None = Query(
        default=None, description="Message id to paginate backwards from"
    ),
    limit: int = Query(default=50, ge=1, le=200),
) -> MessagePage:
    """One page of history, oldest-first, paginating backwards from ``before``."""
    try:
        conversation_service.get_for_user(db, conversation_id, current_user.id)
        return message_service.get_history(
            db, conversation_id, before=before, limit=limit
        )
    except (
        conversation_service.ConversationError,
        message_service.MessageError,
    ) as exc:
        raise _http(exc) from exc


# --------------------------------------------------------------------------- #
# Sending
# --------------------------------------------------------------------------- #


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
)
def send_message(
    conversation_id: str,
    payload: MessageCreate,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> MessageOut:
    """Send over HTTP. Takes the same service path as the WebSocket handler."""
    try:
        conversation = conversation_service.get_for_user(
            db, conversation_id, current_user.id
        )
        message, created = message_service.create_message(
            db,
            conversation=conversation,
            sender=current_user,
            body=payload.body,
            client_id=payload.client_id,
            reply_to_id=payload.reply_to_id,
        )
    except (
        conversation_service.ConversationError,
        message_service.MessageError,
    ) as exc:
        raise _http(exc) from exc

    serialized = message_service.serialize_message(message)
    member_ids = conversation.member_ids()

    if created:
        # Deliver to connected recipients now, then tell the sender their tick moved.
        connected = [
            uid
            for uid in member_ids
            if uid != current_user.id and manager.is_online(uid)
        ]
        for recipient_id in connected:
            message_service.mark_delivered(
                db, user_id=recipient_id, message_ids=[message.id]
            )
        db.refresh(message)
        serialized = message_service.serialize_message(message)

        background.add_task(
            ws.broadcast_new_message,
            serialized.model_dump(mode="json"),
            member_ids,
        )

    return serialized


# --------------------------------------------------------------------------- #
# Receipts
# --------------------------------------------------------------------------- #


@router.post("/conversations/{conversation_id}/read", response_model=list[MessageOut])
def mark_read(
    conversation_id: str,
    payload: ReadReceiptRequest,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> list[MessageOut]:
    """Mark a conversation read up to a message, clearing its unread badge."""
    try:
        conversation_service.get_for_user(db, conversation_id, current_user.id)
        changed = message_service.mark_read(
            db,
            user_id=current_user.id,
            conversation_id=conversation_id,
            up_to_message_id=payload.up_to_message_id,
        )
    except (
        conversation_service.ConversationError,
        message_service.MessageError,
    ) as exc:
        raise _http(exc) from exc

    for message in changed:
        if message.sender_id:
            background.add_task(
                _notify_status,
                message.sender_id,
                message.id,
                conversation_id,
                str(message.status),
            )

    return [message_service.serialize_message(message) for message in changed]


async def _notify_status(
    sender_id: str, message_id: str, conversation_id: str, status_value: str
) -> None:
    from app.realtime.events import ServerEvent, frame

    await manager.send_to_user(
        sender_id,
        frame(
            ServerEvent.MESSAGE_STATUS,
            {
                "message_id": message_id,
                "conversation_id": conversation_id,
                "status": status_value,
            },
        ),
    )


# --------------------------------------------------------------------------- #
# Reactions and deletion
# --------------------------------------------------------------------------- #


@router.put("/messages/{message_id}/reaction", response_model=MessageOut)
def set_reaction(
    message_id: str,
    payload: ReactionSet,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> MessageOut:
    """Set, replace, or clear the caller's reaction.

    Passing ``emoji: null`` -- or the emoji already set -- removes it.
    """
    try:
        message = message_service.get_message(db, message_id)
        conversation = conversation_service.get_for_user(
            db, message.conversation_id, current_user.id
        )
        message = message_service.set_reaction(
            db, message=message, user_id=current_user.id, emoji=payload.emoji
        )
    except (
        conversation_service.ConversationError,
        message_service.MessageError,
    ) as exc:
        raise _http(exc) from exc

    serialized = message_service.serialize_message(message)
    background.add_task(
        _notify_reaction,
        conversation.member_ids(),
        serialized.model_dump(mode="json"),
    )
    return serialized


async def _notify_reaction(member_ids: list[str], message_json: dict) -> None:
    from app.realtime.events import ServerEvent, frame

    await manager.send_to_users(
        member_ids,
        frame(
            ServerEvent.REACTION_UPDATE,
            {
                "message_id": message_json["id"],
                "conversation_id": message_json["conversation_id"],
                "reactions": message_json["reactions"],
            },
        ),
    )


@router.delete("/messages/{message_id}", response_model=MessageOut)
def delete_message(
    message_id: str,
    current_user: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> MessageOut:
    """Delete for everyone. The row survives so the bubble can say so."""
    try:
        message = message_service.get_message(db, message_id)
        conversation = conversation_service.get_for_user(
            db, message.conversation_id, current_user.id
        )
        message = message_service.soft_delete(
            db, message=message, user_id=current_user.id
        )
    except (
        conversation_service.ConversationError,
        message_service.MessageError,
    ) as exc:
        raise _http(exc) from exc

    serialized = message_service.serialize_message(message)
    background.add_task(
        ws.broadcast_new_message,
        serialized.model_dump(mode="json"),
        conversation.member_ids(),
    )
    return serialized
