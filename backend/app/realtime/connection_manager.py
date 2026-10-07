"""Tracks live WebSocket connections and fans frames out to them.

One user may hold several sockets at once (multiple tabs or devices), so the
registry maps a user id to a *set* of sockets. Presence transitions are reported
back to the caller -- ``connect`` returns True only for a user's first socket and
``disconnect`` only for their last -- so the router knows when a genuine
online/offline change happened rather than a tab being opened or closed.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: str, websocket: WebSocket) -> bool:
        """Register an accepted socket. True if this is the user's first."""
        async with self._lock:
            was_offline = not self._sockets[user_id]
            self._sockets[user_id].add(websocket)
        return was_offline

    async def disconnect(self, user_id: str, websocket: WebSocket) -> bool:
        """Deregister a socket. True if the user has no sockets left."""
        async with self._lock:
            sockets = self._sockets.get(user_id)
            if sockets is None:
                return False
            sockets.discard(websocket)
            if sockets:
                return False
            # Drop the empty set so `online_user_ids` stays accurate.
            self._sockets.pop(user_id, None)
            return True

    def is_online(self, user_id: str) -> bool:
        return bool(self._sockets.get(user_id))

    @property
    def online_user_ids(self) -> set[str]:
        return {user_id for user_id, sockets in self._sockets.items() if sockets}

    def connection_count(self) -> int:
        return sum(len(sockets) for sockets in self._sockets.values())

    async def send_to_user(self, user_id: str, frame: dict[str, Any]) -> None:
        """Send one frame to every socket a user holds."""
        for websocket in list(self._sockets.get(user_id, set())):
            await self._safe_send(user_id, websocket, frame)

    async def send_to_users(
        self,
        user_ids: list[str] | set[str],
        frame: dict[str, Any],
        *,
        exclude_user_id: str | None = None,
    ) -> None:
        """Fan one frame out to many users, concurrently."""
        targets = [uid for uid in set(user_ids) if uid != exclude_user_id]
        if not targets:
            return
        await asyncio.gather(
            *(self.send_to_user(user_id, frame) for user_id in targets)
        )

    async def _safe_send(
        self, user_id: str, websocket: WebSocket, frame: dict[str, Any]
    ) -> None:
        """Send, dropping the socket if the peer has gone away.

        A fan-out must never fail because one recipient's socket died between the
        membership lookup and the write.
        """
        try:
            await websocket.send_json(frame)
        except Exception:  # noqa: BLE001 - any send failure means a dead socket
            logger.debug("Dropping dead socket for user %s", user_id, exc_info=True)
            await self.disconnect(user_id, websocket)


# Module-level singleton: the process holds exactly one registry.
#
# This is also the design's main scaling limit -- it lives in memory, so two
# backend instances would not see each other's connections. Scaling out would
# mean putting a Redis pub/sub layer behind this same interface.
manager = ConnectionManager()
