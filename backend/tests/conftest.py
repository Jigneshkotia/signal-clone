"""Test fixtures.

Each test gets a fresh in-memory SQLite database. ``StaticPool`` keeps every
connection pointed at the same in-memory instance -- without it each connection
would get its own empty database and nothing would persist between calls.
"""

from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import mock_crypto, security
from app.database import Base, get_db
from app.main import app
from app.models import (
    Conversation,
    ConversationMember,
    ConversationType,
    MemberRole,
    User,
)


@pytest.fixture
def db() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection, _record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def client(db: Session) -> Generator[TestClient, None, None]:
    """A TestClient whose requests share the test's session."""

    def override_get_db() -> Generator[Session, None, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    # `raise_server_exceptions=False` would hide real bugs; let them surface.
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def make_user(db: Session, name: str, phone: str | None = None) -> User:
    user = User(
        display_name=name,
        phone_number=phone or f"+1555{abs(hash(name)) % 10_000_000:07d}",
        username=name.lower().replace(" ", ""),
        password_hash=security.hash_password("password123"),
        identity_key=mock_crypto.generate_identity_key(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_group(
    db: Session, name: str, members: list[User], admin: User
) -> Conversation:
    conversation = Conversation(type=ConversationType.GROUP, name=name, created_by=admin.id)
    db.add(conversation)
    db.flush()
    for user in members:
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=user.id,
                role=MemberRole.ADMIN if user.id == admin.id else MemberRole.MEMBER,
            )
        )
    db.commit()
    db.refresh(conversation)
    return conversation


@pytest.fixture
def alice(db: Session) -> User:
    return make_user(db, "Alice Adams", "+15550000001")


@pytest.fixture
def bob(db: Session) -> User:
    return make_user(db, "Bob Baker", "+15550000002")


@pytest.fixture
def carol(db: Session) -> User:
    return make_user(db, "Carol Clark", "+15550000003")
