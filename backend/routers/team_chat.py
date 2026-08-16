"""Team Hub group chat.

Phase 1: text-only group thread for team personnel (require_team_access).
Phase 2: supervised MINOR athletes may also join — with their own login linked
to a roster entry — but ONLY after a GUARDIAN (the hub owner OR a caretaker
listed on that athlete's roster entry) approves. Athlete chat is OFF by default,
group-only (there are no private DMs), and every message is visible to the
guardians (who are personnel in the same single group thread).
"""
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from datetime import datetime as _dt, timedelta as _td

from core.db import db
from core.security import get_current_user, require_team_access
from core.helpers import _resolve_active_household
from core.models import utcnow_iso, HouseholdInvite

router = APIRouter(prefix="/api")

MAX_LEN = 2000


def _display_name(user: dict) -> str:
    return (user.get("name") or (user.get("email") or "").split("@")[0] or "Member").strip()


def _is_minor(roster: dict) -> bool:
    """Best-effort minor detection: adult_athlete=True => adult; else use DOB
    (age < 18) if present; otherwise treat athletes as minors (safer default)."""
    if roster.get("adult_athlete") is True:
        return False
    dob = roster.get("dob")
    if dob:
        for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y"):
            try:
                d = datetime.strptime(dob.strip()[:10], fmt)
                age = (datetime.utcnow() - d).days / 365.25
                return age < 18
            except Exception:
                continue
    return True


def _guardian_emails(roster: dict) -> set:
    emails = set()
    if roster.get("parent_email"):
        emails.add(roster["parent_email"].lower().strip())
    for ct in (roster.get("caretakers") or []):
        if ct.get("email"):
            emails.add(ct["email"].lower().strip())
    return emails


async def _chat_hub(user_id: str, user: dict) -> Optional[dict]:
    """The hub whose chat this user participates in. Personnel -> their active
    hub. Athlete participants -> the hub they're linked to. None if neither."""
    if user.get("team_access"):
        return await _resolve_active_household(user_id)
    return await db.households.find_one({"chat_athlete_user_ids": user_id}, {"_id": 0})


async def require_chat_access(current_user=Depends(get_current_user)) -> dict:
    """Allow team personnel, OR an athlete whose guardian has APPROVED chat."""
    if current_user.get("team_access"):
        return current_user
    h = await db.households.find_one({"chat_athlete_user_ids": current_user["id"]}, {"_id": 0, "id": 1})
    if h:
        link = await db.athlete_chat_links.find_one(
            {"household_id": h["id"], "athlete_user_id": current_user["id"]}, {"_id": 0, "chat_enabled": 1}
        )
        if link and link.get("chat_enabled"):
            return current_user
        raise HTTPException(status_code=403, detail="Your parent/guardian hasn't approved Team Chat yet.")
    raise HTTPException(status_code=403, detail="Team Chat is limited to team personnel.")


# ---------------------------------------------------------------- messages ---
@router.get("/team/chat/messages")
async def list_messages(before: Optional[str] = None, limit: int = 40, current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"messages": [], "me": current_user["id"], "has_more": False, "supervised": False}
    limit = max(1, min(int(limit or 40), 100))
    q: dict = {"household_id": h["id"]}
    if before:
        q["created_at"] = {"$lt": before}
    docs = await db.team_messages.find(q, {"_id": 0}).sort("created_at", -1).limit(limit + 1).to_list(limit + 1)
    has_more = len(docs) > limit
    docs = docs[:limit]
    docs.reverse()
    supervised = not current_user.get("team_access")
    return {"messages": docs, "me": current_user["id"], "has_more": has_more, "supervised": supervised}


@router.post("/team/chat/messages")
async def post_message(payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message can't be empty.")
    text = text[:MAX_LEN]
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        raise HTTPException(status_code=403, detail="No chat available.")
    now = utcnow_iso()
    doc = {
        "id": secrets.token_urlsafe(9), "household_id": h["id"],
        "sender_id": current_user["id"], "sender_name": _display_name(current_user),
        "text": text, "created_at": now,
    }
    await db.team_messages.insert_one(dict(doc))
    await db.chat_reads.update_one(
        {"household_id": h["id"], "user_id": current_user["id"]},
        {"$set": {"last_read_at": now}}, upsert=True,
    )
    return doc


@router.post("/team/chat/read")
async def mark_read(current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"ok": True}
    now = utcnow_iso()
    await db.chat_reads.update_one(
        {"household_id": h["id"], "user_id": current_user["id"]},
        {"$set": {"last_read_at": now}}, upsert=True,
    )
    return {"ok": True, "last_read_at": now}


@router.get("/team/chat/unread")
async def unread_count(current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"unread": 0}
    r = await db.chat_reads.find_one(
        {"household_id": h["id"], "user_id": current_user["id"]}, {"_id": 0, "last_read_at": 1}
    )
    last = (r or {}).get("last_read_at") or ""
    q: dict = {"household_id": h["id"], "sender_id": {"$ne": current_user["id"]}}
    if last:
        q["created_at"] = {"$gt": last}
    return {"unread": await db.team_messages.count_documents(q)}


# ------------------------------------------------- athlete access (Phase 2) ---
@router.get("/team/chat/athletes")
async def list_chat_athletes(current_user=Depends(require_team_access)):
    """Roster athletes and their chat-access status (for the management screen)."""
    h = await _resolve_active_household(current_user["id"])
    owner_id = h.get("owner_user_id") or (h.get("member_user_ids") or [None])[0]
    scope_ids = list(set((h.get("member_user_ids") or []) + [owner_id] + (h.get("team_hub_member_user_ids") or [])))
    my_email = (current_user.get("email") or "").lower().strip()
    is_owner = current_user["id"] == owner_id
    links = {l["roster_id"]: l async for l in db.athlete_chat_links.find({"household_id": h["id"]}, {"_id": 0})}
    out = []
    async for m in db.roster.find({"user_id": {"$in": scope_ids}, "role": "athlete"}, {"_id": 0}):
        link = links.get(m["id"]) or {}
        is_guardian = is_owner or (my_email and my_email in _guardian_emails(m))
        out.append({
            "roster_id": m["id"],
            "name": m.get("name") or ((m.get("first_name") or "") + " " + (m.get("last_name") or "")).strip(),
            "is_minor": _is_minor(m),
            "linked": bool(link.get("athlete_user_id")),
            "chat_enabled": bool(link.get("chat_enabled")),
            "invite_code": link.get("invite_code") if not link.get("athlete_user_id") else None,
            "guardian_emails": sorted(_guardian_emails(m)),
            "can_approve": bool(is_guardian),
        })
    return {"athletes": out, "is_owner": is_owner}


@router.post("/team/chat/athletes/{roster_id}/invite")
async def invite_athlete(roster_id: str, current_user=Depends(require_team_access)):
    """Create/refresh a chat invite code for an athlete's login. Any personnel
    can invite; a GUARDIAN must still approve before the athlete can chat."""
    h = await _resolve_active_household(current_user["id"])
    owner_id = h.get("owner_user_id") or (h.get("member_user_ids") or [None])[0]
    scope_ids = list(set((h.get("member_user_ids") or []) + [owner_id] + (h.get("team_hub_member_user_ids") or [])))
    m = await db.roster.find_one({"id": roster_id, "user_id": {"$in": scope_ids}, "role": "athlete"}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Athlete not found on this roster.")
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = "".join(secrets.choice(alphabet) for _ in range(6))
    expires = (_dt.utcnow() + _td(days=14)).isoformat() + "Z"
    invite = HouseholdInvite(
        household_id=h["id"], invited_by=current_user["id"], code=code, expires_at=expires,
        grant_chat_athlete=True, roster_id=roster_id,
    ).model_dump()
    await db.household_invites.insert_one(invite)
    await db.athlete_chat_links.update_one(
        {"household_id": h["id"], "roster_id": roster_id},
        {"$set": {"invite_code": code, "invited_by": current_user["id"], "invited_at": utcnow_iso()},
         "$setOnInsert": {"chat_enabled": False, "created_at": utcnow_iso()}},
        upsert=True,
    )
    return {"code": code, "expires_at": expires, "roster_id": roster_id}


@router.post("/team/chat/athletes/{roster_id}/approve")
async def approve_athlete(roster_id: str, payload: dict = Body(default={}), current_user=Depends(require_team_access)):
    """Guardian-only: turn a linked athlete's chat access ON/OFF."""
    h = await _resolve_active_household(current_user["id"])
    owner_id = h.get("owner_user_id") or (h.get("member_user_ids") or [None])[0]
    scope_ids = list(set((h.get("member_user_ids") or []) + [owner_id] + (h.get("team_hub_member_user_ids") or [])))
    m = await db.roster.find_one({"id": roster_id, "user_id": {"$in": scope_ids}, "role": "athlete"}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Athlete not found on this roster.")
    my_email = (current_user.get("email") or "").lower().strip()
    is_guardian = current_user["id"] == owner_id or (my_email and my_email in _guardian_emails(m))
    if not is_guardian:
        raise HTTPException(status_code=403, detail="Only the athlete's parent/guardian (or account owner) can approve chat.")
    link = await db.athlete_chat_links.find_one({"household_id": h["id"], "roster_id": roster_id}, {"_id": 0})
    if not link or not link.get("athlete_user_id"):
        raise HTTPException(status_code=400, detail="This athlete hasn't set up their login yet.")
    enabled = bool(payload.get("enabled", True))
    await db.athlete_chat_links.update_one(
        {"household_id": h["id"], "roster_id": roster_id},
        {"$set": {"chat_enabled": enabled, "approved_by": current_user["id"], "approved_at": utcnow_iso()}},
    )
    return {"roster_id": roster_id, "chat_enabled": enabled}
