"""Online/last-seen tracking.

Presence is derived from live WebSocket connections: the connection manager owns
the truth about who is connected, and this module persists that to ``users`` so
it survives a page load and can be read over REST.
"""

from __future__ import annotations

from sqlalchemy import distinct, select
from sqlalchemy.orm import Session

from app.models import ConversationMember, User, utcnow


def mark_online(db: Session, user_id: str) -> User | None:
    user = db.get(User, user_id)
    if user is None:
        return None
    user.is_online = True
    user.last_seen_at = utcnow()
    db.commit()
    db.refresh(user)
    return user


def mark_offline(db: Session, user_id: str) -> User | None:
    user = db.get(User, user_id)
    if user is None:
        return None
    user.is_online = False
    user.last_seen_at = utcnow()
    db.commit()
    db.refresh(user)
    return user


def reset_all_offline(db: Session) -> None:
    """Clear stale online flags at startup.

    A crash or redeploy leaves ``is_online`` set for whoever was connected, so
    the process asserts a clean slate on boot rather than trusting old rows.
    """
    db.query(User).filter(User.is_online.is_(True)).update(
        {User.is_online: False}, synchronize_session=False
    )
    db.commit()


def peer_ids(db: Session, user_id: str) -> list[str]:
    """Everyone who shares at least one conversation with this user.

    Presence is only broadcast to these people -- there is no global presence
    feed, so your online state never leaks to strangers.
    """
    my_conversations = select(ConversationMember.conversation_id).where(
        ConversationMember.user_id == user_id
    )
    stmt = (
        select(distinct(ConversationMember.user_id))
        .where(ConversationMember.conversation_id.in_(my_conversations))
        .where(ConversationMember.user_id != user_id)
    )
    return list(db.scalars(stmt))
