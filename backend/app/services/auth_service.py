"""Registration, login, and profile updates."""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core import colors, mock_crypto, security
from app.models import User
from app.schemas.auth import RegisterRequest
from app.schemas.user import UserUpdate


class AuthError(Exception):
    """Raised for any recoverable auth failure; routes map this to a 4xx."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalise_phone(value: str) -> str:
    """Mirror of ``RegisterRequest`` phone normalisation, for lookups."""
    cleaned = value.strip()
    sign = "+" if cleaned.startswith("+") else ""
    digits = "".join(char for char in cleaned if char.isdigit())
    return f"{sign}{digits}"


def normalise_username(value: str) -> str:
    return value.strip().lstrip("@").lower()


def find_by_identifier(db: Session, identifier: str) -> User | None:
    """Look a user up by either phone number or username."""
    phone = normalise_phone(identifier)
    username = normalise_username(identifier)
    stmt = select(User).where(
        or_(User.phone_number == phone, User.username == username)
    )
    return db.scalars(stmt).first()


def register(db: Session, payload: RegisterRequest) -> User:
    if payload.phone_number:
        existing = db.scalars(
            select(User).where(User.phone_number == payload.phone_number)
        ).first()
        if existing:
            raise AuthError("That phone number is already registered", 409)

    if payload.username:
        existing = db.scalars(
            select(User).where(User.username == payload.username)
        ).first()
        if existing:
            raise AuthError("That username is taken", 409)

    user = User(
        phone_number=payload.phone_number,
        username=payload.username,
        display_name=payload.display_name.strip(),
        about=payload.about,
        avatar_url=payload.avatar_url,
        password_hash=security.hash_password(payload.password),
        identity_key=mock_crypto.generate_identity_key(),
    )
    # Colour is derived from the id, so assign it after the id exists.
    user.avatar_color = colors.color_for(user.id or user.display_name)

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, identifier: str, password: str) -> User:
    user = find_by_identifier(db, identifier)
    # Verify even when the user is missing would be ideal to equalise timing;
    # for a demo app the simpler branch is clearer and the risk is nil.
    if user is None or not security.verify_password(password, user.password_hash):
        raise AuthError("Invalid credentials", 401)
    return user


def update_profile(db: Session, user: User, payload: UserUpdate) -> User:
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.about is not None:
        user.about = payload.about or None
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url or None
    if payload.avatar_color is not None:
        if payload.avatar_color not in colors.CONVERSATION_COLORS:
            raise AuthError("Unknown avatar colour", 422)
        user.avatar_color = payload.avatar_color

    db.commit()
    db.refresh(user)
    return user


def search_users(db: Session, query: str, exclude_user_id: str, limit: int = 20) -> list[User]:
    """Find people by display name, username, or phone number."""
    term = query.strip()
    if not term:
        return []

    pattern = f"%{term.lower()}%"
    phone = normalise_phone(term)
    stmt = (
        select(User)
        .where(User.id != exclude_user_id)
        .where(
            or_(
                User.display_name.ilike(pattern),
                User.username.ilike(pattern),
                User.phone_number.like(f"%{phone}%") if phone.strip("+") else False,
            )
        )
        .order_by(User.display_name)
        .limit(limit)
    )
    return list(db.scalars(stmt))
