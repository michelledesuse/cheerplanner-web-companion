"""Athlete Scouting Reports (Team Hub).

A team-wide skill library (Tumbling / Stunting / Jumps) that coaches manage,
plus per-athlete assessments across a fixed 5-level progression. Coaches set
levels + critique notes; athletes and linked parents can view their report and
request a skill review (an in-app "pending" request the coach clears). Reports
are printable and shareable via the existing share-link system.

Follows the ParentGuard permission pattern already used by Team Chat.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core.db import db
from core.security import get_current_user, require_team_access
from core.helpers import _resolve_active_household

router = APIRouter(prefix="/api")

CATEGORIES = ["tumbling", "stunting", "jumps"]
LEVELS = ["on_deck", "spotted", "unassisted", "routine_ready", "hit_zero"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _guardian_emails(roster: dict) -> set:
    emails = set()
    if roster.get("parent_email"):
        emails.add(roster["parent_email"].lower().strip())
    for ct in (roster.get("caretakers") or []):
        if ct.get("email"):
            emails.add(ct["email"].lower().strip())
    return emails


def _scope_ids(h: dict) -> list:
    ids = set((h.get("member_user_ids") or []) + (h.get("team_hub_member_user_ids") or []))
    if h.get("owner_user_id"):
        ids.add(h["owner_user_id"])
    return list(ids)


def _full_name(r: dict) -> str:
    return (r.get("name") or f"{r.get('first_name') or ''} {r.get('last_name') or ''}").strip() or "Athlete"


def _first_name(r: dict) -> str:
    if r.get("first_name"):
        return r["first_name"]
    return (_full_name(r).split(" ") or ["Athlete"])[0]


def _display_name(r: dict) -> str:
    """Privacy-conscious name for on-screen public sharing: first + last initial."""
    first = _first_name(r)
    last = r.get("last_name") or (_full_name(r).split(" ")[-1] if " " in _full_name(r) else "")
    return f"{first} {last[0]}." if last else first


async def _hub_for_roster(roster: dict) -> Optional[dict]:
    return await db.households.find_one(
        {"$or": [{"owner_user_id": roster.get("user_id")}, {"member_user_ids": roster.get("user_id")}]},
        {"_id": 0},
    )


async def _view_role(roster: dict, user: dict):
    """Returns (hub, role) where role is coach|athlete|parent|None."""
    h = await _hub_for_roster(roster)
    if not h:
        return None, None
    scope = _scope_ids(h)
    email = (user.get("email") or "").lower().strip()
    if user.get("team_access") and user["id"] in scope:
        return h, "coach"
    link = await db.athlete_chat_links.find_one(
        {"household_id": h["id"], "roster_id": roster["id"], "athlete_user_id": user["id"]}, {"_id": 0, "roster_id": 1}
    )
    if link is not None:
        return h, "athlete"
    if user["id"] in scope or (email and email in _guardian_emails(roster)):
        return h, "parent"
    return h, None


async def _report_payload(roster: dict, h: dict) -> dict:
    skills = await db.skills.find({"household_id": h["id"]}, {"_id": 0}).sort([("level_group", 1), ("order", 1)]).to_list(1000)
    assess = {}
    async for a in db.athlete_skills.find({"household_id": h["id"], "roster_id": roster["id"]}, {"_id": 0}):
        assess[a["skill_id"]] = a
    pending = set()
    async for rv in db.skill_reviews.find(
        {"household_id": h["id"], "roster_id": roster["id"], "status": "pending"}, {"_id": 0, "skill_id": 1}
    ):
        pending.add(rv["skill_id"])
    cats = {c: [] for c in CATEGORIES}
    for s in skills:
        a = assess.get(s["id"]) or {}
        cats.setdefault(s.get("category") or "tumbling", []).append({
            "skill_id": s["id"], "name": s["name"], "category": s.get("category"),
            "level_group": s.get("level_group") or 1,
            "level": a.get("level"), "notes": a.get("notes") or "",
            "updated_at": a.get("updated_at"),
            "pending_review": s["id"] in pending,
        })
    return {"categories": cats, "levels": LEVELS}


# ---------------------------------------------------------------
# Skill library (coach-managed, team-wide)
# ---------------------------------------------------------------
@router.get("/team/scouting/skills")
async def list_skills(user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        return {"categories": {c: [] for c in CATEGORIES}}
    skills = await db.skills.find({"household_id": h["id"]}, {"_id": 0}).sort([("level_group", 1), ("order", 1)]).to_list(1000)
    cats = {c: [] for c in CATEGORIES}
    for s in skills:
        cats.setdefault(s.get("category") or "tumbling", []).append(s)
    return {"categories": cats}


@router.post("/team/scouting/skills")
async def create_skill(payload: dict = Body(...), user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=400, detail="No team hub found.")
    category = (payload.get("category") or "").lower().strip()
    name = (payload.get("name") or "").strip()
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category.")
    if not name:
        raise HTTPException(status_code=400, detail="Skill name is required.")
    try:
        level_group = int(payload.get("level_group") or 1)
    except (TypeError, ValueError):
        level_group = 1
    level_group = max(1, min(level_group, 7))
    last = await db.skills.find_one(
        {"household_id": h["id"], "category": category, "level_group": level_group}, sort=[("order", -1)]
    )
    order = (last.get("order", 0) + 1) if last else 0
    skill = {"id": str(uuid.uuid4()), "household_id": h["id"], "category": category,
             "level_group": level_group, "name": name, "order": order, "created_at": _now()}
    await db.skills.insert_one(dict(skill))
    return skill


@router.post("/team/scouting/skills/reorder")
async def reorder_skills(payload: dict = Body(...), user=Depends(require_team_access)):
    """Persist a new arrangement after a drag: items = [{id, level_group, order}]."""
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=400, detail="No team hub found.")
    items = payload.get("items") or []
    for i, it in enumerate(items):
        sid = it.get("id")
        if not sid:
            continue
        try:
            lg = max(1, min(int(it.get("level_group") or 1), 7))
        except (TypeError, ValueError):
            lg = 1
        try:
            order = int(it.get("order", i))
        except (TypeError, ValueError):
            order = i
        await db.skills.update_one(
            {"id": sid, "household_id": h["id"]}, {"$set": {"level_group": lg, "order": order}}
        )
    return {"ok": True}


@router.patch("/team/scouting/skills/{skill_id}")
async def update_skill(skill_id: str, payload: dict = Body(...), user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    upd = {}
    if payload.get("name") is not None:
        nm = str(payload["name"]).strip()
        if not nm:
            raise HTTPException(status_code=400, detail="Skill name is required.")
        upd["name"] = nm
    if payload.get("order") is not None:
        upd["order"] = int(payload["order"])
    if not upd:
        return {"ok": True}
    r = await db.skills.update_one({"id": skill_id, "household_id": h["id"]}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Skill not found.")
    return {"ok": True}


@router.delete("/team/scouting/skills/{skill_id}")
async def delete_skill(skill_id: str, user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    await db.skills.delete_one({"id": skill_id, "household_id": h["id"]})
    await db.athlete_skills.delete_many({"household_id": h["id"], "skill_id": skill_id})
    await db.skill_reviews.delete_many({"household_id": h["id"], "skill_id": skill_id})
    return {"ok": True}


# ---------------------------------------------------------------
# Overview / athlete list
# ---------------------------------------------------------------
def _ath_summary(r: dict) -> dict:
    return {"roster_id": r["id"], "name": _full_name(r), "first_name": _first_name(r)}


async def _viewable_rosters(user: dict) -> list:
    out = {}
    email = (user.get("email") or "").lower().strip()
    async for l in db.athlete_chat_links.find({"athlete_user_id": user["id"]}, {"_id": 0, "roster_id": 1}):
        r = await db.roster.find_one({"id": l["roster_id"], "role": "athlete"}, {"_id": 0})
        if r:
            out[r["id"]] = r
    async for h in db.households.find(
        {"$or": [{"owner_user_id": user["id"]}, {"member_user_ids": user["id"]}]}, {"_id": 0}
    ):
        async for r in db.roster.find({"user_id": {"$in": _scope_ids(h)}, "role": "athlete"}, {"_id": 0}):
            out[r["id"]] = r
    if email:
        async for r in db.roster.find(
            {"role": "athlete", "parent_email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}, {"_id": 0}
        ):
            out[r["id"]] = r
    return list(out.values())


@router.get("/team/scouting/overview")
async def overview(user=Depends(get_current_user)):
    if user.get("team_access"):
        h = await _resolve_active_household(user["id"])
        if h:
            athletes = await db.roster.find(
                {"user_id": {"$in": _scope_ids(h)}, "role": "athlete"}, {"_id": 0}
            ).sort("name", 1).to_list(1000)
            pending = await db.skill_reviews.count_documents({"household_id": h["id"], "status": "pending"})
            return {"role": "coach", "athletes": [_ath_summary(a) for a in athletes], "pending_requests": pending}
    viewable = await _viewable_rosters(user)
    return {"role": "viewer", "athletes": [_ath_summary(a) for a in viewable], "pending_requests": 0}


# ---------------------------------------------------------------
# Scouting report (coach / athlete / parent)
# ---------------------------------------------------------------
@router.get("/team/scouting/report/{roster_id}")
async def get_report(roster_id: str, user=Depends(get_current_user)):
    roster = await db.roster.find_one({"id": roster_id}, {"_id": 0})
    if not roster:
        raise HTTPException(status_code=404, detail="Athlete not found.")
    h, role = await _view_role(roster, user)
    if not role:
        raise HTTPException(status_code=403, detail="You don't have access to this scouting report.")
    payload = await _report_payload(roster, h)
    return {
        "roster_id": roster_id, "name": _full_name(roster), "first_name": _first_name(roster),
        "role": role, "can_edit": role == "coach", "can_request": role in ("athlete", "parent"),
        **payload,
    }


@router.put("/team/scouting/report/{roster_id}/skill/{skill_id}")
async def set_assessment(roster_id: str, skill_id: str, payload: dict = Body(default={}), user=Depends(require_team_access)):
    roster = await db.roster.find_one({"id": roster_id}, {"_id": 0})
    if not roster:
        raise HTTPException(status_code=404, detail="Athlete not found.")
    h, role = await _view_role(roster, user)
    if role != "coach":
        raise HTTPException(status_code=403, detail="Only coaches can update skill levels.")
    skill = await db.skills.find_one({"id": skill_id, "household_id": h["id"]}, {"_id": 0, "id": 1})
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found.")
    level = payload.get("level")
    if level in ("", None):
        level = None
    elif level not in LEVELS:
        raise HTTPException(status_code=400, detail="Invalid level.")
    upd = {"updated_by": user["id"], "updated_at": _now()}
    if "level" in payload:
        upd["level"] = level
    if "notes" in payload:
        upd["notes"] = str(payload.get("notes") or "")
    await db.athlete_skills.update_one(
        {"household_id": h["id"], "roster_id": roster_id, "skill_id": skill_id},
        {"$set": upd, "$setOnInsert": {"id": str(uuid.uuid4())}},
        upsert=True,
    )
    # Updating clears any pending review for this skill.
    await db.skill_reviews.update_many(
        {"household_id": h["id"], "roster_id": roster_id, "skill_id": skill_id, "status": "pending"},
        {"$set": {"status": "resolved", "resolved_at": _now()}},
    )
    return {"ok": True}


@router.post("/team/scouting/report/{roster_id}/skill/{skill_id}/request-review")
async def request_review(roster_id: str, skill_id: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    roster = await db.roster.find_one({"id": roster_id}, {"_id": 0})
    if not roster:
        raise HTTPException(status_code=404, detail="Athlete not found.")
    h, role = await _view_role(roster, user)
    if role not in ("athlete", "parent"):
        raise HTTPException(status_code=403, detail="Only the athlete or a parent can request a review.")
    skill = await db.skills.find_one({"id": skill_id, "household_id": h["id"]}, {"_id": 0, "id": 1})
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found.")
    existing = await db.skill_reviews.find_one(
        {"household_id": h["id"], "roster_id": roster_id, "skill_id": skill_id, "status": "pending"}, {"_id": 0, "id": 1}
    )
    if existing:
        return {"ok": True, "already": True}
    await db.skill_reviews.insert_one({
        "id": str(uuid.uuid4()), "household_id": h["id"], "roster_id": roster_id, "skill_id": skill_id,
        "requested_by_user_id": user["id"], "requested_by_name": user.get("name") or "A family member",
        "status": "pending", "note": str(payload.get("note") or ""), "created_at": _now(),
    })
    return {"ok": True}


# ---------------------------------------------------------------
# Review requests inbox (coach) — the in-app "notification"
# ---------------------------------------------------------------
@router.get("/team/scouting/review-requests")
async def list_review_requests(user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        return {"requests": [], "count": 0}
    reqs = await db.skill_reviews.find(
        {"household_id": h["id"], "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    out = []
    for rv in reqs:
        roster = await db.roster.find_one({"id": rv["roster_id"]}, {"_id": 0})
        skill = await db.skills.find_one({"id": rv["skill_id"]}, {"_id": 0, "name": 1, "category": 1})
        if not roster or not skill:
            continue
        out.append({
            "id": rv["id"], "roster_id": rv["roster_id"], "athlete_name": _full_name(roster),
            "skill_id": rv["skill_id"], "skill_name": skill["name"], "category": skill.get("category"),
            "requested_by_name": rv.get("requested_by_name"), "note": rv.get("note") or "",
            "created_at": rv.get("created_at"),
        })
    return {"requests": out, "count": len(out)}


@router.post("/team/scouting/review-requests/{req_id}/dismiss")
async def dismiss_request(req_id: str, user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    await db.skill_reviews.update_one(
        {"id": req_id, "household_id": h["id"]}, {"$set": {"status": "resolved", "resolved_at": _now()}}
    )
    return {"ok": True}


# ---------------------------------------------------------------
# Public share data (called from share.py)
# ---------------------------------------------------------------
async def public_scouting_data(roster: dict, h: dict) -> dict:
    payload = await _report_payload(roster, h)
    return {
        "kind": "scouting",
        "title": "Scouting Report",
        "display_name": _display_name(roster),  # on-screen (privacy-conscious)
        "full_name": _full_name(roster),         # used by the printable download
        "level_labels": {
            "on_deck": "On Deck", "spotted": "Spotted", "unassisted": "Unassisted",
            "routine_ready": "Routine Ready", "hit_zero": "Hit Zero",
        },
        **payload,
    }
