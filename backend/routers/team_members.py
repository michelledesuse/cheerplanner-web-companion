"""Team Hub membership: one reusable join code, a pending-member queue, and
owner role assignment that attaches each new member to the right profile.

Flow (does NOT touch the existing household/athlete invite flows):
  1. Owner shares ONE reusable team join code.
  2. Anyone who joins with it lands in `team_members` as status="pending" and
     gets GROUP-CHAT-ONLY access (no roster, expenses, travel, etc.). The owner
     sees them in a "New Members" list with a badge count.
  3. Owner assigns a role — Parent of an Athlete / Coach / Staff / Athlete — and
     the member is attached to the appropriate profile:
       • parent  -> linked as a guardian on an athlete's roster entry
       • coach    -> roster entry + full Team Hub access (team_access)
       • staff    -> roster entry + full Team Hub access (team_access)
       • athlete  -> roster entry + supervised chat athlete link
"""
import secrets
from typing import Optional, List

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

from core.db import db
from core.security import get_current_user
from core.helpers import _resolve_active_household, _household_owner_id
from core.models import RosterMember, utcnow_iso

router = APIRouter(prefix="/api/team")

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no confusing 0/O/1/I
_ROLES = ("parent", "coach", "staff", "athlete")


def _new_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(6))


async def _require_owner_hub(user_id: str) -> dict:
    """Return the user's active hub, ensuring they are its OWNER (managers only)."""
    h = await _resolve_active_household(user_id)
    if not h or _household_owner_id(h) != user_id:
        raise HTTPException(status_code=403, detail="Only the team owner can manage members.")
    return h


async def _user_label(uid: str) -> dict:
    u = await db.users.find_one({"id": uid}, {"_id": 0, "name": 1, "email": 1})
    u = u or {}
    return {"name": u.get("name") or (u.get("email") or "").split("@")[0] or "Member", "email": u.get("email")}


# ------------------------------------------------------------ join code ---
@router.get("/join-code")
async def get_join_code(current_user=Depends(get_current_user)):
    """Owner-only: the ONE reusable code the whole team joins with."""
    h = await _require_owner_hub(current_user["id"])
    code = h.get("team_join_code")
    if not code:
        code = _new_code()
        await db.households.update_one({"id": h["id"]}, {"$set": {"team_join_code": code}})
    return {"code": code}


@router.post("/join-code/rotate")
async def rotate_join_code(current_user=Depends(get_current_user)):
    """Owner-only: generate a fresh code (old one stops working)."""
    h = await _require_owner_hub(current_user["id"])
    code = _new_code()
    await db.households.update_one({"id": h["id"]}, {"$set": {"team_join_code": code}})
    return {"code": code}


@router.post("/join")
async def join_team(payload: dict = Body(default={}), current_user=Depends(get_current_user)):
    """Anyone: join a team with its code. Lands in the pending queue with
    group-chat-only access until the owner assigns a role."""
    code = (payload.get("code") or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Enter a team code.")
    h = await db.households.find_one({"team_join_code": code}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="That team code isn't valid.")
    uid = current_user["id"]
    owner_id = _household_owner_id(h)
    if uid == owner_id or uid in (h.get("team_hub_member_user_ids") or []) or uid in (h.get("member_user_ids") or []):
        raise HTTPException(status_code=400, detail="You're already part of this team.")
    existing = await db.team_members.find_one({"household_id": h["id"], "user_id": uid}, {"_id": 0})
    if existing:
        return {"joined": True, "status": existing.get("status", "pending"), "team_name": h.get("hub_name")}
    now = utcnow_iso()
    await db.team_members.insert_one({
        "id": secrets.token_urlsafe(9), "household_id": h["id"], "user_id": uid,
        "status": "pending", "role": None, "athlete_roster_id": None, "joined_at": now,
    })
    # In-app notification for the owner (drives the "New Members" badge/list).
    who = await _user_label(uid)
    await db.team_join_notifications.insert_one({
        "id": secrets.token_urlsafe(9), "household_id": h["id"], "owner_id": owner_id,
        "user_id": uid, "name": who["name"], "created_at": now, "read": False,
    })
    return {"joined": True, "status": "pending", "team_name": h.get("hub_name")}


# --------------------------------------------------------- member lists ---
@router.get("/members/pending-count")
async def pending_count(current_user=Depends(get_current_user)):
    """Badge count of members awaiting a role + whether the caller owns a hub.
    Owner-only data (0 / False for everyone else)."""
    h = await _resolve_active_household(current_user["id"])
    if not h or _household_owner_id(h) != current_user["id"]:
        return {"count": 0, "is_owner": False}
    n = await db.team_members.count_documents({"household_id": h["id"], "status": "pending"})
    return {"count": n, "is_owner": True}


@router.get("/members")
async def list_members(current_user=Depends(get_current_user)):
    """Owner-only: the New Members queue + already-assigned members."""
    h = await _require_owner_hub(current_user["id"])
    roster = {r["id"]: r async for r in db.roster.find(
        {"user_id": {"$in": [_household_owner_id(h)]}}, {"_id": 0, "id": 1, "name": 1})}
    pending, active = [], []
    async for tm in db.team_members.find({"household_id": h["id"]}, {"_id": 0}).sort("joined_at", -1):
        who = await _user_label(tm["user_id"])
        rids = tm.get("athlete_roster_ids") or ([tm["athlete_roster_id"]] if tm.get("athlete_roster_id") else [])
        names = [n for n in ((roster.get(r) or {}).get("name") for r in rids) if n]
        row = {
            "user_id": tm["user_id"], "name": who["name"], "email": who["email"],
            "status": tm.get("status"), "role": tm.get("role"),
            "athlete_roster_id": tm.get("athlete_roster_id"),
            "athlete_roster_ids": rids,
            "athlete_name": ", ".join(names) if names else None,
            "joined_at": tm.get("joined_at"),
        }
        (pending if tm.get("status") == "pending" else active).append(row)
    return {"pending": pending, "active": active, "pending_count": len(pending)}


@router.get("/members/athletes")
async def assignable_athletes(current_user=Depends(get_current_user)):
    """Existing roster athletes an owner can link a Parent to."""
    h = await _require_owner_hub(current_user["id"])
    owner_id = _household_owner_id(h)
    out = []
    async for r in db.roster.find({"user_id": owner_id, "role": "athlete"}, {"_id": 0, "id": 1, "name": 1}):
        out.append({"roster_id": r["id"], "name": r.get("name") or "Athlete"})
    return {"athletes": out}


# ------------------------------------------------------- role assignment ---
class AssignPayload(BaseModel):
    role: str
    athlete_roster_id: Optional[str] = None
    athlete_name: Optional[str] = None
    # A Parent can be linked to SEVERAL children at once.
    athlete_roster_ids: Optional[List[str]] = None
    athlete_names: Optional[List[str]] = None


async def _create_roster_entry(owner_id: str, name: str, role: str, member_uid: str) -> dict:
    who = await _user_label(member_uid)
    first, _, last = (name or who["name"]).partition(" ")
    doc = RosterMember(
        user_id=owner_id, name=(name or who["name"]).strip() or "Member",
        first_name=first or None, last_name=(last or None), role=role,
        email=who["email"], source="manual", linked_id=member_uid,
    ).model_dump()
    await db.roster.insert_one(dict(doc))
    return doc


@router.post("/members/{user_id}/assign-role")
async def assign_role(user_id: str, payload: AssignPayload, current_user=Depends(get_current_user)):
    h = await _require_owner_hub(current_user["id"])
    owner_id = _household_owner_id(h)
    role = (payload.role or "").strip().lower()
    if role not in _ROLES:
        raise HTTPException(status_code=400, detail="Pick a valid role.")
    tm = await db.team_members.find_one({"household_id": h["id"], "user_id": user_id}, {"_id": 0})
    if not tm:
        raise HTTPException(status_code=404, detail="That member isn't in this team.")
    who = await _user_label(user_id)
    now = utcnow_iso()
    athlete_roster_id = None

    if role in ("coach", "staff"):
        # Full Team Hub access + roster entry.
        await db.users.update_one({"id": user_id}, {"$set": {"team_access": True, "active_hub_id": h["id"]}})
        await db.households.update_one({"id": h["id"]}, {"$addToSet": {"team_hub_member_user_ids": user_id}})
        await _create_roster_entry(owner_id, who["name"], role, user_id)

    elif role == "athlete":
        # Roster athlete + supervised chat link (group-only, no DMs).
        if payload.athlete_roster_id:
            r = await db.roster.find_one({"id": payload.athlete_roster_id, "user_id": owner_id}, {"_id": 0, "id": 1})
            if not r:
                raise HTTPException(status_code=404, detail="Athlete not found.")
            athlete_roster_id = r["id"]
        else:
            doc = await _create_roster_entry(owner_id, payload.athlete_name or who["name"], "athlete", user_id)
            athlete_roster_id = doc["id"]
        await db.households.update_one({"id": h["id"]}, {"$addToSet": {"chat_athlete_user_ids": user_id}})
        await db.athlete_chat_links.update_one(
            {"household_id": h["id"], "roster_id": athlete_roster_id},
            {"$set": {"athlete_user_id": user_id, "chat_enabled": True,
                      "approved_by": current_user["id"], "approved_at": now},
             "$setOnInsert": {"created_at": now}},
            upsert=True,
        )

    else:  # parent — link as a guardian on ONE OR MORE athletes' roster entries
        want_ids = list(payload.athlete_roster_ids or [])
        if payload.athlete_roster_id:
            want_ids.append(payload.athlete_roster_id)
        want_names = list(payload.athlete_names or [])
        if payload.athlete_name and payload.athlete_name.strip():
            want_names.append(payload.athlete_name.strip())
        linked_ids: list = []
        # existing athletes
        for rid in dict.fromkeys(want_ids):  # de-dupe, keep order
            athlete = await db.roster.find_one({"id": rid, "user_id": owner_id}, {"_id": 0})
            if not athlete:
                raise HTTPException(status_code=404, detail="Athlete not found.")
            linked_ids.append(athlete["id"])
        # newly-named athletes
        for nm in want_names:
            if nm.strip():
                doc = await _create_roster_entry(owner_id, nm.strip(), "athlete", "")
                linked_ids.append(doc["id"])
        if not linked_ids:
            raise HTTPException(status_code=400, detail="Choose or name at least one athlete to link this parent to.")
        pfirst, _, plast = (who["name"] or "").partition(" ")
        for rid in linked_ids:
            athlete = await db.roster.find_one({"id": rid}, {"_id": 0, "id": 1, "parent_email": 1})
            # Attach the parent as a recognized guardian (reuses existing guardian logic).
            if not (athlete or {}).get("parent_email"):
                await db.roster.update_one({"id": rid}, {"$set": {
                    "parent_email": who["email"], "parent_first_name": pfirst or None,
                    "parent_last_name": plast or None,
                }})
            else:
                await db.roster.update_one({"id": rid}, {"$addToSet": {"caretakers": {
                    "name": who["name"], "email": who["email"], "relationship": "Parent",
                }}})
        athlete_roster_id = linked_ids[0]

    await db.team_members.update_one(
        {"household_id": h["id"], "user_id": user_id},
        {"$set": {"status": "active", "role": role,
                  "athlete_roster_id": athlete_roster_id,
                  "athlete_roster_ids": (linked_ids if role == "parent" else ([athlete_roster_id] if athlete_roster_id else [])),
                  "assigned_by": current_user["id"], "assigned_at": now}},
    )
    await db.team_join_notifications.update_many(
        {"household_id": h["id"], "user_id": user_id}, {"$set": {"read": True}})
    ids_out = (linked_ids if role == "parent" else ([athlete_roster_id] if athlete_roster_id else []))
    return {"user_id": user_id, "role": role, "status": "active",
            "athlete_roster_id": athlete_roster_id, "athlete_roster_ids": ids_out}


@router.post("/members/{user_id}/remove")
async def remove_member(user_id: str, current_user=Depends(get_current_user)):
    """Owner-only: reject a pending member or remove an assigned one from chat/access."""
    h = await _require_owner_hub(current_user["id"])
    tm = await db.team_members.find_one({"household_id": h["id"], "user_id": user_id}, {"_id": 0})
    if not tm:
        raise HTTPException(status_code=404, detail="That member isn't in this team.")
    # Revoke chat + hub access granted by this membership.
    await db.households.update_one({"id": h["id"]}, {
        "$pull": {"team_hub_member_user_ids": user_id, "chat_athlete_user_ids": user_id}})
    await db.athlete_chat_links.delete_many({"household_id": h["id"], "athlete_user_id": user_id})
    # Only drop team_access if they don't own/collaborate on any other hub.
    still = await db.households.count_documents({
        "$or": [{"owner_user_id": user_id}, {"team_hub_member_user_ids": user_id}]})
    if not still:
        await db.users.update_one({"id": user_id}, {"$set": {"team_access": False}})
    await db.team_members.delete_one({"household_id": h["id"], "user_id": user_id})
    await db.team_join_notifications.delete_many({"household_id": h["id"], "user_id": user_id})
    return {"removed": True}
