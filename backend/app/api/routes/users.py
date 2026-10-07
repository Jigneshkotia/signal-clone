"""Profile updates and people search."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser, DbSession
from app.core.colors import CONVERSATION_COLORS
from app.schemas.user import UserMe, UserPublic, UserUpdate
from app.services import auth_service

router = APIRouter(prefix="/users", tags=["users"])


@router.patch("/me", response_model=UserMe)
def update_me(payload: UserUpdate, current_user: CurrentUser, db: DbSession) -> UserMe:
    try:
        user = auth_service.update_profile(db, current_user, payload)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return UserMe.model_validate(user)


@router.get("/search", response_model=list[UserPublic])
def search_users(
    current_user: CurrentUser,
    db: DbSession,
    q: str = Query(min_length=1, description="Name, username, or phone number"),
    limit: int = Query(default=20, ge=1, le=50),
) -> list[UserPublic]:
    """Find people to start a conversation with. Excludes the caller."""
    users = auth_service.search_users(db, q, exclude_user_id=current_user.id, limit=limit)
    return [UserPublic.model_validate(user) for user in users]


@router.get("/colors")
def list_colors() -> dict[str, str]:
    """Signal's twelve conversation colors, for the avatar picker."""
    return CONVERSATION_COLORS


@router.get("/{user_id}", response_model=UserPublic)
def get_user(user_id: str, current_user: CurrentUser, db: DbSession) -> UserPublic:
    from app.models import User

    _ = current_user
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return UserPublic.model_validate(user)
