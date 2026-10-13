"""Live updates: every open web app gets each change as a small JSON event over /api/ws.

Events carry keys and ids, never ticket text beyond a short preview, and go only to signed-in
owner sessions (agents poll the HTTP API).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, Set

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self._sockets: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def add(self, ws: WebSocket) -> None:
        async with self._lock:
            self._sockets.add(ws)

    async def remove(self, ws: WebSocket) -> None:
        async with self._lock:
            self._sockets.discard(ws)

    async def broadcast(self, kind: str, data: Dict[str, Any]) -> None:
        message = {"type": kind, "data": data, "server_time": server_time()}
        async with self._lock:
            sockets = list(self._sockets)
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - a closed socket is dropped
                await self.remove(ws)

    def count(self) -> int:
        return len(self._sockets)


hub = Hub()


def server_time() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def broadcast_sync_event(kind: str, data: Dict[str, Any]) -> None:
    await hub.broadcast(kind, data)
