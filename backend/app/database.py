"""SQLAlchemy engine, session factory, and the declarative base.

SQLite needs two specific accommodations:

* ``check_same_thread=False`` because FastAPI serves requests from a thread pool
  while WebSocket handlers run on the event loop, so a connection can legitimately
  be touched from more than one thread.
* ``PRAGMA foreign_keys=ON`` per connection, since SQLite leaves foreign-key
  enforcement off by default and we rely on it for cascade deletes.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    echo=settings.debug,
    future=True,
)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:
    """Enable FK enforcement and WAL mode on every new SQLite connection."""
    if not _is_sqlite:
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL lets readers proceed while a writer holds the lock, which matters once
    # WebSocket fan-out and HTTP requests write concurrently.
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base for every ORM model."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all() -> None:
    """Create any missing tables. Imported for the side effect of model registration."""
    from app import models  # noqa: F401  (registers mappers on Base.metadata)

    Base.metadata.create_all(bind=engine)
