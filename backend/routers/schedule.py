import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    ScheduleEvent, ScheduleEventCreate, ScheduleEventUpdate, RecurrenceRule,
)
from core.security import get_current_user
from core.helpers import _household_user_ids, _expand_recurrence

router = APIRouter(prefix="/api")


@router.get("/schedule", response_model=List[ScheduleEvent])
async def list_schedule(
    athlete_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    q = {"user_id": {"$in": await _household_user_ids(current_user["id"])}}
    if athlete_id:
        q["athlete_ids"] = athlete_id
    docs = await db.schedule_events.find(q, {"_id": 0}).sort("date", 1).to_list(5000)
    return [ScheduleEvent(**d) for d in docs]


@router.post("/schedule", response_model=List[ScheduleEvent])
async def create_schedule(payload: ScheduleEventCreate, current_user=Depends(get_current_user)):
    base = payload.model_dump()
    rule = base.pop("recurrence_rule", None)

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
        return entries

    entry = ScheduleEvent(user_id=current_user["id"], **base)
    await db.schedule_events.insert_one(entry.model_dump())
    return [entry]


@router.patch("/schedule/{event_id}")
async def update_schedule(
    event_id: str,
    payload: ScheduleEventUpdate,
    scope: str = "single",  # "single" | "series"
    current_user=Depends(get_current_user),
):
    sent = payload.model_dump(exclude_unset=True)
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

    await db.schedule_events.delete_one({"id": event_id, "user_id": {"$in": member_ids}})
    return {"deleted": 1, "scope": "single"}
