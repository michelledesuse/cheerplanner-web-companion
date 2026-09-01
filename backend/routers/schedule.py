import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    ScheduleEvent, ScheduleEventCreate, ScheduleEventUpdate, RecurrenceRule,
)
from core.security import get_current_user
from core.helpers import _household_user_ids, _expand_recurrence, _date_range, season_date_query
from core.activity import log_activity

router = APIRouter(prefix="/api")


@router.get("/schedule", response_model=List[ScheduleEvent])
async def list_schedule(
    athlete_id: Optional[str] = None,
    season_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    member_ids = await _household_user_ids(current_user["id"])
    q = await season_date_query(member_ids, season_id, "date")
    if athlete_id:
        q["athlete_ids"] = athlete_id
    docs = await db.schedule_events.find(q, {"_id": 0}).sort("date", 1).to_list(5000)
    return [ScheduleEvent(**d) for d in docs]


@router.post("/schedule", response_model=List[ScheduleEvent])
async def create_schedule(payload: ScheduleEventCreate, current_user=Depends(get_current_user)):
    base = payload.model_dump()
    rule = base.pop("recurrence_rule", None)
    # Normalize Optional[List] fields: None -> [] so ScheduleEvent (which
    # requires lists) doesn't 500 when the client omits these keys.
    for k in ("photos", "season_ids", "athlete_ids", "links", "event_reminder_offsets"):
        if base.get(k) is None:
            base[k] = []

    if rule:
        rule_obj = RecurrenceRule(**rule) if not isinstance(rule, RecurrenceRule) else rule
        dates = _expand_recurrence(base["date"], rule_obj)
        series_id = str(uuid.uuid4())
        entries = []
        for d in dates:
            ev = ScheduleEvent(
                user_id=current_user["id"],
                **{**base, "date": d},
                series_id=series_id,
                recurrence_rule=rule_obj,
            )
            entries.append(ev)
        if entries:
            await db.schedule_events.insert_many([e.model_dump() for e in entries])
            await log_activity(actor_user_id=current_user["id"], resource="event",
                               resource_id=entries[0].id, resource_name=entries[0].title, action="added")
        return entries

    # Multi-day range (no recurrence): split into one editable event per day,
    # linked by a shared series_id so each day can hold different links/times.
    start_date = base.get("date")
    end_date = base.get("end_date")
    if end_date and start_date and end_date > start_date:
        dates = _date_range(start_date, end_date)
        series_id = str(uuid.uuid4())
        entries = [
            ScheduleEvent(
                user_id=current_user["id"],
                **{**base, "date": d, "end_date": None},
                series_id=series_id,
            )
            for d in dates
        ]
        if entries:
            await db.schedule_events.insert_many([e.model_dump() for e in entries])
            await log_activity(actor_user_id=current_user["id"], resource="event",
                               resource_id=entries[0].id, resource_name=entries[0].title, action="added")
        return entries

    entry = ScheduleEvent(user_id=current_user["id"], **base)
    await db.schedule_events.insert_one(entry.model_dump())
    await log_activity(actor_user_id=current_user["id"], resource="event",
                       resource_id=entry.id, resource_name=entry.title, action="added")
    return [entry]


@router.patch("/schedule/{event_id}")
async def update_schedule(
    event_id: str,
    payload: ScheduleEventUpdate,
    scope: str = "single",  # "single" | "series"
    current_user=Depends(get_current_user),
):
    sent = payload.model_dump(exclude_unset=True)
    sent.pop("edit_scope", None)  # not used for events (they use recurrence scope below)
    nullable = {"location", "start_time", "end_time", "notes", "team_id", "end_date"}
    updates = {k: v for k, v in sent.items() if v is not None or k in nullable}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.schedule_events.find_one(
        {"id": event_id, "user_id": {"$in": member_ids}}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")

    await log_activity(actor_user_id=current_user["id"], resource="event",
                       resource_id=event_id,
                       resource_name=updates.get("title") or existing.get("title"), action="updated")


    if scope == "series" and existing.get("series_id"):
        # Don't propagate date across the series — date is per-instance.
        series_updates = {k: v for k, v in updates.items() if k != "date"}
        if series_updates:
            await db.schedule_events.update_many(
                {"series_id": existing["series_id"], "user_id": {"$in": member_ids}},
                {"$set": series_updates},
            )
        if "date" in updates:
            await db.schedule_events.update_one(
                {"id": event_id, "user_id": {"$in": member_ids}},
                {"$set": {"date": updates["date"]}},
            )
        docs = await db.schedule_events.find(
            {"series_id": existing["series_id"], "user_id": {"$in": member_ids}}, {"_id": 0}
        ).sort("date", 1).to_list(5000)
        return {"updated": len(docs), "scope": "series", "events": [ScheduleEvent(**d).model_dump() for d in docs]}

    if scope == "future" and existing.get("series_id"):
        # Apply to this occurrence and every later one in the series.
        future_updates = {k: v for k, v in updates.items() if k != "date"}
        if future_updates:
            await db.schedule_events.update_many(
                {"series_id": existing["series_id"], "user_id": {"$in": member_ids},
                 "date": {"$gte": existing["date"]}},
                {"$set": future_updates},
            )
        if "date" in updates:
            await db.schedule_events.update_one(
                {"id": event_id, "user_id": {"$in": member_ids}},
                {"$set": {"date": updates["date"]}},
            )
        docs = await db.schedule_events.find(
            {"series_id": existing["series_id"], "user_id": {"$in": member_ids},
             "date": {"$gte": existing["date"]}}, {"_id": 0}
        ).sort("date", 1).to_list(5000)
        return {"updated": len(docs), "scope": "future", "events": [ScheduleEvent(**d).model_dump() for d in docs]}

    await db.schedule_events.update_one(
        {"id": event_id, "user_id": {"$in": member_ids}},
        {"$set": updates},
    )
    doc = await db.schedule_events.find_one({"id": event_id}, {"_id": 0})
    return {"updated": 1, "scope": "single", "events": [ScheduleEvent(**doc).model_dump()]}


@router.delete("/schedule/{event_id}")
async def delete_schedule(
    event_id: str,
    scope: str = "single",
    current_user=Depends(get_current_user),
):
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.schedule_events.find_one(
        {"id": event_id, "user_id": {"$in": member_ids}}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")

    if scope == "series" and existing.get("series_id"):
        res = await db.schedule_events.delete_many(
            {"series_id": existing["series_id"], "user_id": {"$in": member_ids}}
        )
        return {"deleted": res.deleted_count, "scope": "series"}

    if scope == "future" and existing.get("series_id"):
        res = await db.schedule_events.delete_many(
            {"series_id": existing["series_id"], "user_id": {"$in": member_ids},
             "date": {"$gte": existing["date"]}}
        )
        return {"deleted": res.deleted_count, "scope": "future"}

    await db.schedule_events.delete_one({"id": event_id, "user_id": {"$in": member_ids}})
    return {"deleted": 1, "scope": "single"}



@router.post("/schedule/{event_id}/reschedule-series", response_model=List[ScheduleEvent])
async def reschedule_series(
    event_id: str,
    payload: ScheduleEventCreate,
    anchor: str = "series_start",  # "series_start" | "this"
    current_user=Depends(get_current_user),
):
    """Change the recurrence pattern of an existing event/series.

    Regenerates the whole series from a new recurrence_rule. Existing
    occurrences (and their per-day customizations) are replaced by fresh
    occurrences built from the shared fields in `payload`. If
    `recurrence_rule` is omitted, the series collapses to a single event.

    anchor="series_start" (default) keeps the series' original start date;
    anchor="this" restarts the series from the edited occurrence's date.
    """
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.schedule_events.find_one(
        {"id": event_id, "user_id": {"$in": member_ids}}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")

    owner_id = existing["user_id"]
    series_id = existing.get("series_id")

    # Determine the anchor (start) date for the regenerated series.
    if anchor == "this":
        anchor_date = existing["date"]
    elif series_id:
        first = await db.schedule_events.find(
            {"series_id": series_id, "user_id": {"$in": member_ids}}, {"_id": 0, "date": 1}
        ).sort("date", 1).limit(1).to_list(1)
        anchor_date = first[0]["date"] if first else existing["date"]
    else:
        anchor_date = existing["date"]

    base = payload.model_dump()
    rule = base.pop("recurrence_rule", None)
    base.pop("end_date", None)  # recurrence & multi-day range are mutually exclusive
    for k in ("photos", "season_ids", "athlete_ids", "links", "event_reminder_offsets"):
        if base.get(k) is None:
            base[k] = []

    # Remove the old occurrences.
    if series_id:
        await db.schedule_events.delete_many(
            {"series_id": series_id, "user_id": {"$in": member_ids}}
        )
    else:
        await db.schedule_events.delete_one({"id": event_id, "user_id": {"$in": member_ids}})

    if rule:
        rule_obj = RecurrenceRule(**rule) if not isinstance(rule, RecurrenceRule) else rule
        dates = _expand_recurrence(anchor_date, rule_obj)
        new_series_id = series_id or str(uuid.uuid4())
        entries = [
            ScheduleEvent(
                user_id=owner_id,
                **{**base, "date": d},
                series_id=new_series_id,
                recurrence_rule=rule_obj,
            )
            for d in dates
        ]
        if entries:
            await db.schedule_events.insert_many([e.model_dump() for e in entries])
        await log_activity(actor_user_id=current_user["id"], resource="event",
                           resource_id=entries[0].id if entries else event_id,
                           resource_name=base.get("title"), action="updated")
        return entries

    # No rule → collapse to a single standalone event on the anchor date.
    entry = ScheduleEvent(user_id=owner_id, **{**base, "date": anchor_date})
    await db.schedule_events.insert_one(entry.model_dump())
    await log_activity(actor_user_id=current_user["id"], resource="event",
                       resource_id=entry.id, resource_name=entry.title, action="updated")
    return [entry]
