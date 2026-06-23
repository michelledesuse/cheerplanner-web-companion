from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import Athlete, AthleteCreate, AthleteUpdate
from core.security import get_current_user
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api")


@router.get("/athletes", response_model=List[Athlete])
async def list_athletes(current_user=Depends(get_current_user)):
    docs = await db.athletes.find(
        {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    return [Athlete(**d) for d in docs]


@router.post("/athletes", response_model=Athlete)
async def create_athlete(payload: AthleteCreate, current_user=Depends(get_current_user)):
    # exclude None so Pydantic can apply default_factory (e.g. competition_ids=[])
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    athlete = Athlete(user_id=current_user["id"], **data)
    await db.athletes.insert_one(athlete.model_dump())
    return athlete


@router.patch("/athletes/{athlete_id}", response_model=Athlete)
async def update_athlete(athlete_id: str, payload: AthleteUpdate, current_user=Depends(get_current_user)):
    # Honor explicit nulls for nullable fields so users can clear them (e.g. remove avatar)
    nullable_fields = {"team", "gym", "avatar_image"}
    sent = payload.model_dump(exclude_unset=True)
    updates: dict = {}
    for k, v in sent.items():
        if v is None and k not in nullable_fields:
            continue
        updates[k] = v
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.athletes.update_one(
        {"id": athlete_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    doc = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    return Athlete(**doc)


@router.delete("/athletes/{athlete_id}")
async def delete_athlete(athlete_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.athletes.delete_one({"id": athlete_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    await db.expenses.delete_many({"athlete_id": athlete_id, "user_id": {"$in": member_ids}})
    await db.payments.delete_many({"athlete_id": athlete_id, "user_id": {"$in": member_ids}})
    return {"deleted": True}
