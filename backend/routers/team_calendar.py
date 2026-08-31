"""Team Practice Calendar (Team Hub).

Staff create one-off or recurring events (weekly-by-weekday or monthly). Events
auto-push to all athletes/parents on the team. Parents/athletes can hide an
occurrence from their own family view only. Each occurrence supports per-athlete
RSVP (Attending / Not Attending + reason). Reasons are staff-only.

Follows the ParentGuard permission pattern.
"""
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core.db import db
from core.security import get_current_user, require_team_access
from core.helpers import _resolve_active_household, _expand_recurrence
from core.models import ScheduleEvent, RecurrenceRule
from routers.scouting import _viewable_rosters, _full_name, _scope_ids

router = APIRouter(prefix="/api")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _d(s: str) -> Optional[date]:
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None


async def _hub_and_role(user: dict):
    if user.get("team_access"):
        h = await _resolve_active_household(user["id"])
        if h:
            return h, "staff"
    link = await db.athlete_chat_links.find_one({"athlete_user_id": user["id"]}, {"_id": 0, "household_id": 1})
    if link:
        h = await db.households.find_one({"id": link["household_id"]}, {"_id": 0})
        if h:
            return h, "viewer"
    h = await db.households.find_one({"$or": [{"owner_user_id": user["id"]}, {"member_user_ids": user["id"]}]}, {"_id": 0})
    if h:
        return h, "viewer"
    email = (user.get("email") or "").lower().strip()
    if email:
        r = await db.roster.find_one({"role": "athlete", "parent_email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}, {"_id": 0, "user_id": 1})
        if r:
            h = await db.households.find_one({"$or": [{"owner_user_id": r["user_id"]}, {"member_user_ids": r["user_id"]}]}, {"_id": 0})
            if h:
                return h, "viewer"
    return None, None


def _occurrences(ev: dict, win_from: date, win_to: date) -> list:
    """Expand an event into occurrence dates (YYYY-MM-DD) within [win_from, win_to]."""
    start = _d(ev.get("date"))
    if not start:
        return []
    rec = ev.get("recurrence") or {}
    freq = rec.get("freq") or "none"
    until = _d(rec.get("until")) or win_to
    end = min(win_to, until)
    out = []
    if freq == "none":
        if win_from <= start <= win_to:
            out.append(start.isoformat())
        return out
    interval = max(1, int(rec.get("interval") or 1))
    if freq == "daily":
        cur = start
        guard = 0
        while cur <= end and guard < 1200:
            guard += 1
            if cur >= start and cur >= win_from:
                out.append(cur.isoformat())
            cur += timedelta(days=interval)
    elif freq == "weekly":
        raw = rec.get("byweekday")
        if raw:
            # Stored as Sun=0..Sat=6 (JS getDay); convert to Python Mon=0..Sun=6.
            days = set((int(x) - 1) % 7 for x in raw)
        else:
            days = {start.weekday()}
        cur = start
        guard = 0
        while cur <= end and guard < 800:
            guard += 1
            weeks = (cur - start).days // 7
            if cur >= start and cur.weekday() in days and weeks % interval == 0 and cur >= win_from:
                out.append(cur.isoformat())
            cur += timedelta(days=1)
    elif freq == "monthly":
        y, m, dnum = start.year, start.month, start.day
        guard = 0
        while guard < 240:
            guard += 1
            try:
                occ = date(y, m, dnum)
            except ValueError:
                occ = None
            if occ:
                if occ > end:
                    break
                if occ >= start and occ >= win_from:
                    out.append(occ.isoformat())
            m += interval
            while m > 12:
                m -= 12
                y += 1
    return sorted(set(out))


# ---------------------------------------------------------------
# Staff CRUD
# ---------------------------------------------------------------
@router.post("/team/calendar/events")
async def create_event(payload: dict = Body(...), user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=400, detail="No team hub found.")
    if not (payload.get("title") or "").strip():
        raise HTTPException(status_code=400, detail="Event title is required.")
    if not _d(payload.get("date")):
        raise HTTPException(status_code=400, detail="A valid start date is required.")
    rec = payload.get("recurrence") or {"freq": "none"}
    ev = {
        "id": str(uuid.uuid4()), "household_id": h["id"], "title": payload["title"].strip(),
        "event_type": (payload.get("event_type") or "practice"),
        "location": (payload.get("location") or "").strip(),
        "address": (payload.get("address") or "").strip(), "date": str(payload["date"])[:10],
        "start_time": payload.get("start_time") or "", "end_time": payload.get("end_time") or "",
        "notes": (payload.get("notes") or "").strip(), "recurrence": rec,
        "created_by": user["id"], "created_at": _now(),
    }
    await db.team_events.insert_one(dict(ev))
    return ev


@router.patch("/team/calendar/events/{event_id}")
async def update_event(event_id: str, payload: dict = Body(...), user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    upd = {}
    for f in ("title", "location", "address", "notes", "start_time", "end_time", "event_type"):
        if f in payload:
            upd[f] = (payload.get(f) or "").strip() if isinstance(payload.get(f), str) else payload.get(f)
    if "date" in payload and _d(payload["date"]):
        upd["date"] = str(payload["date"])[:10]
    if "recurrence" in payload:
        upd["recurrence"] = payload["recurrence"] or {"freq": "none"}
    r = await db.team_events.update_one({"id": event_id, "household_id": h["id"]}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Event not found.")
    return {"ok": True}


@router.delete("/team/calendar/events/{event_id}")
async def delete_event(event_id: str, user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    await db.team_events.delete_one({"id": event_id, "household_id": h["id"]})
    await db.calendar_rsvps.delete_many({"event_id": event_id})
    await db.calendar_hides.delete_many({"event_id": event_id})
    return {"ok": True}


# ---------------------------------------------------------------
# Listing (staff + viewers)
# ---------------------------------------------------------------
@router.get("/team/calendar/events")
async def list_events(from_: str = None, to: str = None, user=Depends(get_current_user)):
    h, role = await _hub_and_role(user)
    if not h:
        return {"role": "viewer", "events": []}
    win_from = _d(from_) or date.today()
    win_to = _d(to) or (win_from + timedelta(days=120))
    evs = await db.team_events.find({"household_id": h["id"]}, {"_id": 0}).to_list(1000)
    # viewer's hidden occurrences + their athletes' rsvps
    hidden = set()
    my_rosters = []
    if role == "viewer":
        async for hd in db.calendar_hides.find({"user_id": user["id"]}, {"_id": 0, "event_id": 1, "occ_date": 1}):
            hidden.add((hd["event_id"], hd["occ_date"]))
        my_rosters = await _viewable_rosters(user)
    my_roster_ids = [r["id"] for r in my_rosters]
    out = []
    for ev in evs:
        for occ in _occurrences(ev, win_from, win_to):
            if role == "viewer" and (ev["id"], occ) in hidden:
                continue
            row = {
                "event_id": ev["id"], "occ_date": occ, "title": ev["title"], "location": ev.get("location"),
                "address": ev.get("address"), "event_type": ev.get("event_type") or "practice",
                "start_time": ev.get("start_time"), "end_time": ev.get("end_time"), "notes": ev.get("notes"),
                "recurring": (ev.get("recurrence") or {}).get("freq", "none") != "none",
                "recurrence": ev.get("recurrence") or {"freq": "none"}, "event_date": ev.get("date"),
                "can_edit": role == "staff",
            }
            if role == "staff":
                cnt = await db.calendar_rsvps.count_documents({"event_id": ev["id"], "occ_date": occ})
                row["rsvp_count"] = cnt
            else:
                mine = []
                async for rv in db.calendar_rsvps.find(
                    {"event_id": ev["id"], "occ_date": occ, "roster_id": {"$in": my_roster_ids}}, {"_id": 0}
                ):
                    mine.append({"roster_id": rv["roster_id"], "status": rv["status"]})
                row["my_rsvps"] = mine
            out.append(row)
    out.sort(key=lambda r: (r["occ_date"], r.get("start_time") or ""))
    resp = {"role": role, "events": out}
    if role == "viewer":
        resp["athletes"] = [{"roster_id": r["id"], "name": _full_name(r)} for r in my_rosters]
    return resp


# ---------------------------------------------------------------
# Family hide (viewer only)
# ---------------------------------------------------------------
@router.post("/team/calendar/hide")
async def hide_occ(payload: dict = Body(...), user=Depends(get_current_user)):
    ev_id, occ = payload.get("event_id"), payload.get("occ_date")
    if not ev_id or not occ:
        raise HTTPException(status_code=400, detail="event_id and occ_date required.")
    await db.calendar_hides.update_one(
        {"user_id": user["id"], "event_id": ev_id, "occ_date": occ},
        {"$set": {"user_id": user["id"], "event_id": ev_id, "occ_date": occ, "at": _now()}}, upsert=True,
    )
    return {"ok": True}


@router.post("/team/calendar/unhide")
async def unhide_occ(payload: dict = Body(...), user=Depends(get_current_user)):
    await db.calendar_hides.delete_one({"user_id": user["id"], "event_id": payload.get("event_id"), "occ_date": payload.get("occ_date")})
    return {"ok": True}


# ---------------------------------------------------------------
# RSVP
# ---------------------------------------------------------------
@router.post("/team/calendar/rsvp")
async def set_rsvp(payload: dict = Body(...), user=Depends(get_current_user)):
    h, role = await _hub_and_role(user)
    if not h:
        raise HTTPException(status_code=403, detail="No team access.")
    ev_id, occ, roster_id = payload.get("event_id"), payload.get("occ_date"), payload.get("roster_id")
    status = payload.get("status")
    if status not in ("attending", "not_attending"):
        raise HTTPException(status_code=400, detail="Invalid RSVP status.")
    reason = (payload.get("reason") or "").strip()
    if status == "not_attending" and not reason:
        raise HTTPException(status_code=400, detail="A reason is required when not attending.")
    # Ensure the requester may RSVP for this athlete
    allowed = {r["id"] for r in await _viewable_rosters(user)}
    if role == "staff":
        allowed |= {r["id"] async for r in db.roster.find({"user_id": {"$in": _scope_ids(h)}, "role": "athlete"}, {"_id": 0, "id": 1})}
    if roster_id not in allowed:
        raise HTTPException(status_code=403, detail="You can't RSVP for this athlete.")
    await db.calendar_rsvps.update_one(
        {"event_id": ev_id, "occ_date": occ, "roster_id": roster_id},
        {"$set": {"event_id": ev_id, "occ_date": occ, "roster_id": roster_id, "status": status,
                  "reason": reason if status == "not_attending" else "", "by_user_id": user["id"], "updated_at": _now()}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/team/calendar/rsvps")
async def list_rsvps(event_id: str, occ_date: str, user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        return {"rsvps": []}
    out = []
    async for rv in db.calendar_rsvps.find({"event_id": event_id, "occ_date": occ_date}, {"_id": 0}):
        roster = await db.roster.find_one({"id": rv["roster_id"]}, {"_id": 0})
        out.append({
            "roster_id": rv["roster_id"], "athlete_name": _full_name(roster) if roster else "Athlete",
            "status": rv["status"], "reason": rv.get("reason") or "",
        })
    out.sort(key=lambda r: r["athlete_name"])
    attending = sum(1 for r in out if r["status"] == "attending")
    return {"rsvps": out, "attending": attending, "not_attending": len(out) - attending}



# ---------------------------------------------------------------
# Import team events into a family's personal in-app calendar
# ---------------------------------------------------------------
def _to_schedule_rule(rec: dict) -> Optional[dict]:
    """Map a team-calendar recurrence to a personal-schedule RecurrenceRule dict.

    Team byweekday and schedule days_of_week both use Sun=0..Sat=6, so day
    indexes pass through unchanged.
    """
    rec = rec or {}
    freq = rec.get("freq") or "none"
    if freq == "none":
        return None
    until = rec.get("until") or ""
    if not until:
        # RecurrenceRule requires an end; cap at ~1 year out from today.
        until = (date.today() + timedelta(days=365)).isoformat()
    if freq == "daily":
        return {"frequency": "daily", "days_of_week": [], "until": until}
    if freq == "monthly":
        return {"frequency": "monthly", "days_of_week": [], "until": until}
    if freq == "weekly":
        interval = int(rec.get("interval") or 1)
        return {
            "frequency": "biweekly" if interval == 2 else "weekly",
            "days_of_week": [int(x) for x in (rec.get("byweekday") or [])],
            "until": until,
        }
    return None


async def _import_one(ev: dict, user: dict) -> int:
    """Create personal schedule events mirroring a team event (whole series).

    Returns number of schedule rows created (0 if already imported)."""
    existing = await db.schedule_events.find_one(
        {"user_id": user["id"], "imported_from_team_event_id": ev["id"]}, {"_id": 0, "id": 1}
    )
    if existing:
        return 0
    base = {
        "event_type": ev.get("event_type") or "practice",
        "title": ev.get("title") or "Team event",
        "location": ev.get("location") or None,
        "address": ev.get("address") or None,
        "start_time": ev.get("start_time") or None,
        "end_time": ev.get("end_time") or None,
        "notes": ev.get("notes") or None,
        "date": str(ev.get("date"))[:10],
    }
    rule = _to_schedule_rule(ev.get("recurrence"))
    series_id = str(uuid.uuid4())
    if rule:
        rule_obj = RecurrenceRule(**rule)
        dates = _expand_recurrence(base["date"], rule_obj)
        rows = [
            ScheduleEvent(user_id=user["id"], **{**base, "date": d}, series_id=series_id,
                          recurrence_rule=rule_obj)
            for d in dates
        ]
    else:
        rows = [ScheduleEvent(user_id=user["id"], **base)]
    if rows:
        docs = []
        for r in rows:
            d = r.model_dump()
            d["imported_from_team_event_id"] = ev["id"]
            docs.append(d)
        await db.schedule_events.insert_many(docs)
    return len(rows)


@router.post("/team/calendar/import-to-personal")
async def import_to_personal(payload: dict = Body(...), user=Depends(get_current_user)):
    h, role = await _hub_and_role(user)
    if not h:
        raise HTTPException(status_code=403, detail="No team access.")
    ev = await db.team_events.find_one({"id": payload.get("event_id"), "household_id": h["id"]}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found.")
    created = await _import_one(ev, user)
    return {"ok": True, "created": created, "already": created == 0}


@router.post("/team/calendar/import-all-to-personal")
async def import_all_to_personal(user=Depends(get_current_user)):
    h, role = await _hub_and_role(user)
    if not h:
        raise HTTPException(status_code=403, detail="No team access.")
    evs = await db.team_events.find({"household_id": h["id"]}, {"_id": 0}).to_list(1000)
    imported = 0
    skipped = 0
    for ev in evs:
        c = await _import_one(ev, user)
        if c:
            imported += 1
        else:
            skipped += 1
    return {"ok": True, "imported": imported, "skipped": skipped}
