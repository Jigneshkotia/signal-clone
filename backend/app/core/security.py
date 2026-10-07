"""Password hashing and JWT issuing/verification.

``bcrypt`` is used directly rather than through passlib: passlib 1.7.x misreads
the version of bcrypt 4+ and emits a spurious error on import, and we only need
two functions from it anyway.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.config import settings

# bcrypt truncates silently past 72 bytes, so reject rather than quietly ignore.
MAX_PASSWORD_BYTES = 72


class TokenError(Exception):
    """Raised when a JWT is malformed, expired, or signed with the wrong key."""


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if len(encoded) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    encoded = password.encode("utf-8")
    if len(encoded) > MAX_PASSWORD_BYTES:
        return False
    try:
        return bcrypt.checkpw(encoded, password_hash.encode("utf-8"))
    except ValueError:
        # Malformed hash in the database; treat as a failed login, not a 500.
        return False


def create_access_token(user_id: str, expires_minutes: int | None = None) -> str:
    """Issue a signed JWT whose subject is the user id."""
    minutes = expires_minutes if expires_minutes is not None else settings.jwt_expire_minutes
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str:
    """Return the user id carried by ``token``, or raise :class:`TokenError`."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise TokenError("Token is missing a subject claim")
    return user_id
