from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import Season, SeasonCreate, SeasonUpdate, SeasonRollover
from core.security import get_current_user
from core.helpers import _household_user_ids

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
    count = await db.seasons.count_documents({"user_id": {"$in": member_ids}})
    make_active = payload.make_active or count == 0  # first season is active by default
    season = Season(
        user_id=current_user["id"], name=name,
        start_date=payload.start_date, end_date=payload.end_date,
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
