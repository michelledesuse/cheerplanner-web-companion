from typing import List

from fastapi import APIRouter, Depends, HTTPException
import re

from core.db import db
from core.models import Season, SeasonCreate, SeasonUpdate, SeasonRollover, SeasonRolloverCreate
from core.security import get_current_user
from core.helpers import _household_user_ids, season_overlap

router = APIRouter(prefix="/api")

# Collections whose docs carry season_ids and can be rolled over / filtered.
KIND_COLLECTIONS = {
    "athletes": db.athletes,
    "teams": db.teams,
    "competitions": db.competitions,
    "events": db.schedule_events,
}


@router.get("/seasons", response_model=List[Season])
async def list_seasons(current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.seasons.find({"user_id": {"$in": member_ids}}, {"_id": 0}).to_list(200)
    docs.sort(key=lambda s: (s.get("order", 0), s.get("start_date") or "", s.get("created_at") or ""))
    return [Season(**d) for d in docs]


@router.post("/seasons", response_model=Season)
async def create_season(payload: SeasonCreate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Season name is required")
    start, end = payload.start_date, payload.end_date
    if not start or not end:
        raise HTTPException(status_code=400, detail="Start date and end date are required")
    if end[:10] <= start[:10]:
        raise HTTPException(status_code=400, detail="End date must be after the start date")
    clash = await season_overlap(member_ids, start, end)
    if clash:
        raise HTTPException(status_code=400, detail=f"These dates overlap your \"{clash.get('name')}\" season. Pick a non-overlapping range.")
    count = await db.seasons.count_documents({"user_id": {"$in": member_ids}})
    make_active = payload.make_active or count == 0  # first season is active by default
    season = Season(
        user_id=current_user["id"], name=name,
        start_date=start, end_date=end,
        is_active=make_active, order=count,
    )
    if make_active:
        await db.seasons.update_many({"user_id": {"$in": member_ids}}, {"$set": {"is_active": False}})
    await db.seasons.insert_one(season.model_dump())
    return season


@router.patch("/seasons/{season_id}", response_model=Season)
async def update_season(season_id: str, payload: SeasonUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "name" in updates and not (updates["name"] or "").strip():
        raise HTTPException(status_code=400, detail="Season name cannot be blank")
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "start_date" in updates or "end_date" in updates:
        existing = await db.seasons.find_one({"id": season_id, "user_id": {"$in": member_ids}}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Season not found")
        start = updates.get("start_date", existing.get("start_date"))
        end = updates.get("end_date", existing.get("end_date"))
        if start and end:
            if end[:10] <= start[:10]:
                raise HTTPException(status_code=400, detail="End date must be after the start date")
            clash = await season_overlap(member_ids, start, end, exclude_id=season_id)
            if clash:
                raise HTTPException(status_code=400, detail=f"These dates overlap your \"{clash.get('name')}\" season. Pick a non-overlapping range.")
    res = await db.seasons.update_one(
        {"id": season_id, "user_id": {"$in": member_ids}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Season not found")
    doc = await db.seasons.find_one({"id": season_id}, {"_id": 0})
    return Season(**doc)


@router.post("/seasons/{season_id}/activate", response_model=Season)
async def activate_season(season_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.seasons.find_one({"id": season_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Season not found")
    await db.seasons.update_many({"user_id": {"$in": member_ids}}, {"$set": {"is_active": False}})
    await db.seasons.update_one({"id": season_id}, {"$set": {"is_active": True}})
    doc["is_active"] = True
    return Season(**doc)


@router.delete("/seasons/{season_id}")
async def delete_season(season_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.seasons.find_one({"id": season_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Season not found")
    await db.seasons.delete_one({"id": season_id})
    # Detach the season from every entity that referenced it (keeps the entities).
    for coll in KIND_COLLECTIONS.values():
        await coll.update_many(
            {"user_id": {"$in": member_ids}, "season_ids": season_id},
            {"$pull": {"season_ids": season_id}},
        )
    # If we removed the active season, promote the first remaining season.
    if doc.get("is_active"):
        nxt = await db.seasons.find_one({"user_id": {"$in": member_ids}}, {"_id": 0}, sort=[("order", 1)])
        if nxt:
            await db.seasons.update_one({"id": nxt["id"]}, {"$set": {"is_active": True}})
    return {"deleted": True}


@router.post("/seasons/{season_id}/rollover")
async def rollover_season(season_id: str, payload: SeasonRollover, current_user=Depends(get_current_user)):
    """Attach every entity currently in `season_id` (for the chosen kinds) to the
    target season as well — so athletes/teams/comps/events carry over without
    losing their history in the previous season (multi-season membership)."""
    member_ids = await _household_user_ids(current_user["id"])
    src = await db.seasons.find_one({"id": season_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    tgt = await db.seasons.find_one({"id": payload.target_season_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not src or not tgt:
        raise HTTPException(status_code=404, detail="Season not found")
    if season_id == payload.target_season_id:
        raise HTTPException(status_code=400, detail="Pick a different target season")
    moved = {}
    for kind in payload.kinds:
        coll = KIND_COLLECTIONS.get(kind)
        if coll is None:
            continue
        res = await coll.update_many(
            {"user_id": {"$in": member_ids}, "season_ids": season_id},
            {"$addToSet": {"season_ids": payload.target_season_id}},
        )
        moved[kind] = res.modified_count
    return {"rolled_over": moved, "target": tgt["name"]}


@router.post("/seasons/rollover-create")
async def rollover_create(payload: SeasonRolloverCreate, current_user=Depends(get_current_user)):
    """Create a NEW season and carry forward reusable scaffolding (teams +
    selected athletes) from the source season by tagging them into the new one.

    Additive-only: the source season and its data are never modified.
    Duplicate-safe: rejects a same-name or date-overlapping season.
    """
    member_ids = await _household_user_ids(current_user["id"])
    src = await db.seasons.find_one({"id": payload.source_season_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not src:
        raise HTTPException(status_code=404, detail="Source season not found")

    name = (payload.name or "").strip()
    start, end = payload.start_date, payload.end_date
    if not name:
        raise HTTPException(status_code=400, detail="Season name is required")
    if not start or not end:
        raise HTTPException(status_code=400, detail="Start date and end date are required")
    if end[:10] <= start[:10]:
        raise HTTPException(status_code=400, detail="End date must be after the start date")

    # Duplicate-safe: same (normalized) name already exists?
    dupe_name = await db.seasons.find_one(
        {"user_id": {"$in": member_ids}, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
        {"_id": 0, "name": 1},
    )
    if dupe_name:
        raise HTTPException(status_code=409, detail=f"You already have a \"{dupe_name['name']}\" season. Open it instead of rolling over again.")
    clash = await season_overlap(member_ids, start, end)
    if clash:
        raise HTTPException(status_code=409, detail=f"These dates overlap your \"{clash.get('name')}\" season, so it looks like next season already exists.")

    count = await db.seasons.count_documents({"user_id": {"$in": member_ids}})
    new_season = Season(
        user_id=current_user["id"], name=name, start_date=start, end_date=end,
        is_active=True, order=count,
    )
    await db.seasons.update_many({"user_id": {"$in": member_ids}}, {"$set": {"is_active": False}})
    await db.seasons.insert_one(new_season.model_dump())

    summary = {"teams": 0, "athletes": 0}
    # Carry forward is ADDITIVE: tag each carried record with BOTH the source and
    # the new season, so it stays in the source season and also joins the new one.
    both = {"$each": [payload.source_season_id, new_season.id]}
    if payload.carry_teams:
        src_team_q = {"user_id": {"$in": member_ids}, "$or": [
            {"season_ids": payload.source_season_id},
            {"season_ids": {"$in": [None, []]}},
            {"season_ids": {"$exists": False}},
        ]}
        team_ids = [t["id"] async for t in db.teams.find(src_team_q, {"_id": 0, "id": 1})]
        if team_ids:
            await db.teams.update_many({"id": {"$in": team_ids}}, {"$addToSet": {"season_ids": both}})
        summary["teams"] = len(team_ids)
    if payload.athlete_ids:
        await db.athletes.update_many(
            {"user_id": {"$in": member_ids}, "id": {"$in": payload.athlete_ids}},
            {"$addToSet": {"season_ids": both}},
        )
        summary["athletes"] = len(payload.athlete_ids)
    return {"season": new_season.model_dump(), "summary": summary}
