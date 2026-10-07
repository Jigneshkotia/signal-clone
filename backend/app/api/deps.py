"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import TokenError, decode_access_token
from app.database import get_db
from app.models import User

# auto_error=False so a missing header produces our own 401 with a clean message
# rather than FastAPI's default 403.
_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]

_UNAUTHORISED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
) -> User:
    """Resolve the bearer token to a user, or raise 401."""
    if credentials is None or not credentials.credentials:
        raise _UNAUTHORISED

    try:
        user_id = decode_access_token(credentials.credentials)
    except TokenError as exc:
        raise _UNAUTHORISED from exc

    user = db.get(User, user_id)
    if user is None:
        raise _UNAUTHORISED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
