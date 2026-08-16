"""Real-time sync (W3) — authenticated WebSocket fan-out.

Clients connect to /api/ws?token=<jwt> and are subscribed to their household
room(s). After any successful mutating HTTP request, an `invalidate` event is
broadcast to the acting user's rooms so every connected web/phone client
refetches the affected data live.

In-process only (single worker). For multi-worker deployments, back the
ConnectionManager with a Redis pub/sub — the interface stays the same.
"""
import logging
from collections import defaultdict
from typing import List, Optional

import jwt
from fastapi import WebSocket

from core.db import db
from core.config import JWT_SECRET, JWT_ALGORITHM
from core.helpers import _get_or_create_household

logger = logging.getLogger("cheerplanner")


async def _user_from_token(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        uid = payload.get("sub")
    except Exception:
        return None
    if not uid:
        return None
    return await db.users.find_one({"id": uid}, {"_id": 0, "id": 1})


async def _user_from_auth_header(header: Optional[str]) -> Optional[dict]:
    if not header or not header.lower().startswith("bearer "):
        return None
    return await _user_from_token(header.split(" ", 1)[1])


async def rooms_for_user(user_id: str) -> List[str]:
    """Household rooms this user belongs to: their own household + any Team Hub
    they collaborate on."""
    ids = set()
    own = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0, "id": 1})
    if own:
        ids.add(own["id"])
    async for h in db.households.find({"team_hub_member_user_ids": user_id}, {"_id": 0, "id": 1}):
        ids.add(h["id"])
    async for h in db.households.find({"chat_athlete_user_ids": user_id}, {"_id": 0, "id": 1}):
        ids.add(h["id"])
    if not ids:
        h = await _get_or_create_household(user_id)
        ids.add(h["id"])
    return list(ids)


class ConnectionManager:
    def __init__(self):
        self.rooms = defaultdict(set)  # household_id -> set[WebSocket]

    async def connect(self, ws: WebSocket, room_ids: List[str]):
        await ws.accept()
        for r in room_ids:
            self.rooms[r].add(ws)

    def disconnect(self, ws: WebSocket, room_ids: List[str]):
        for r in room_ids:
            self.rooms.get(r, set()).discard(ws)

    async def broadcast(self, room_ids: List[str], message: dict):
        seen = set()
        dead = []
        for r in room_ids:
            for ws in list(self.rooms.get(r, ())):
                if ws in seen:
                    continue
                seen.add(ws)
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append(ws)
        for ws in dead:
            for r in room_ids:
                self.rooms.get(r, set()).discard(ws)


manager = ConnectionManager()
