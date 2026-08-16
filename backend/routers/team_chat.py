"""Team Hub — Phase 1 group chat (text-only, supervised group thread).

One conversation per Team Hub, keyed by the active hub's household id. Participants
are everyone connected to that hub: household members + Team Hub collaborators
(coaches) + the owner. Access is gated to team personnel (require_team_access),
so Phase 1 is inherently adults/coaches only.

Realtime: message POSTs are mutating HTTP requests, so the existing broadcast
middleware fans out an `invalidate` to the hub's room (which every member AND
collaborator is subscribed to) — connected clients refetch live.
"""
import secrets
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core.db import db
from core.security import require_team_access
from core.helpers import _resolve_active_household
from core.models import utcnow_iso

router = APIRouter(prefix="/api")

MAX_LEN = 2000


async def _hub(user_id: str) -> dict:
    return await _resolve_active_household(user_id)


def _display_name(user: dict) -> str:
    return (user.get("name") or (user.get("email") or "").split("@")[0] or "Member").strip()


@router.get("/team/chat/messages")
async def list_messages(
    before: Optional[str] = None,
    limit: int = 40,
    current_user=Depends(require_team_access),
):
    """Latest messages for the active hub (ascending for display). Pass `before`
    (an ISO created_at) to page backwards through history."""
    h = await _hub(current_user["id"])
    limit = max(1, min(int(limit or 40), 100))
    q: dict = {"household_id": h["id"]}
    if before:
        q["created_at"] = {"$lt": before}
    docs = await db.team_messages.find(q, {"_id": 0}).sort("created_at", -1).limit(limit + 1).to_list(limit + 1)
    has_more = len(docs) > limit
    docs = docs[:limit]
    docs.reverse()
    return {"messages": docs, "me": current_user["id"], "has_more": has_more}


@router.post("/team/chat/messages")
async def post_message(payload: dict = Body(default={}), current_user=Depends(require_team_access)):
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message can't be empty.")
    text = text[:MAX_LEN]
    h = await _hub(current_user["id"])
    now = utcnow_iso()
    doc = {
        "id": secrets.token_urlsafe(9),
        "household_id": h["id"],
        "sender_id": current_user["id"],
        "sender_name": _display_name(current_user),
        "text": text,
        "created_at": now,
    }
    await db.team_messages.insert_one(dict(doc))
    # Sender has implicitly read up to their own message.
    await db.chat_reads.update_one(
        {"household_id": h["id"], "user_id": current_user["id"]},
        {"$set": {"last_read_at": now}}, upsert=True,
    )
    return doc


@router.post("/team/chat/read")
async def mark_read(current_user=Depends(require_team_access)):
    h = await _hub(current_user["id"])
    now = utcnow_iso()
    await db.chat_reads.update_one(
        {"household_id": h["id"], "user_id": current_user["id"]},
        {"$set": {"last_read_at": now}}, upsert=True,
    )
    return {"ok": True, "last_read_at": now}


@router.get("/team/chat/unread")
async def unread_count(current_user=Depends(require_team_access)):
    h = await _hub(current_user["id"])
    r = await db.chat_reads.find_one(
        {"household_id": h["id"], "user_id": current_user["id"]}, {"_id": 0, "last_read_at": 1}
    )
    last = (r or {}).get("last_read_at") or ""
    q: dict = {"household_id": h["id"], "sender_id": {"$ne": current_user["id"]}}
    if last:
        q["created_at"] = {"$gt": last}
    n = await db.team_messages.count_documents(q)
    return {"unread": n}
