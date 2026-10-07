"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, contacts, conversations, messages, users
from app.config import settings
from app.database import SessionLocal, create_all
from app.realtime import router as realtime_router
from app.realtime.connection_manager import manager
from app.services import presence_service

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Prepare the database on boot.

    Render's free tier has an ephemeral disk, so a redeploy starts from an empty
    file -- seeding when there are no users keeps the hosted demo immediately
    usable rather than showing an empty app.
    """
    create_all()

    with SessionLocal() as db:
        # Nobody can be online before the first socket connects; clear any flags
        # left set by a crash or redeploy.
        presence_service.reset_all_offline(db)

    if settings.seed_on_startup:
        from app.seed import seed_if_empty

        seeded = seed_if_empty()
        if seeded:
            logger.info("Seeded demo data")

    logger.info("%s ready", settings.app_name)
    yield


app = FastAPI(
    title=settings.app_name,
    description=(
        "Backend for a Signal Messenger clone. Encryption is simulated -- see "
        "`app/core/mock_crypto.py`. Real-time traffic flows over `/ws`."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    # Vercel gives every deployment its own preview hostname, so match them all
    # instead of pinning one URL per push.
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api"

app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(users.router, prefix=API_PREFIX)
app.include_router(contacts.router, prefix=API_PREFIX)
app.include_router(conversations.router, prefix=API_PREFIX)
app.include_router(messages.router, prefix=API_PREFIX)

# The WebSocket sits at the root, not under /api, so the URL stays `wss://host/ws`.
app.include_router(realtime_router.router)


@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "docs": "/docs",
        "websocket": "/ws?token=<jwt>",
    }


@app.get("/health", tags=["meta"])
def health() -> dict[str, object]:
    """Liveness probe. Also reports live socket counts, which is handy in a demo."""
    return {
        "status": "ok",
        "connected_users": len(manager.online_user_ids),
        "open_sockets": manager.connection_count(),
    }
