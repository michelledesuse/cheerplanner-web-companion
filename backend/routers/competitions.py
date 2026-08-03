from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import Competition, CompetitionCreate, CompetitionUpdate
from core.security import get_current_user
from core.helpers import _household_user_ids, season_query, apply_scoped_update

router = APIRouter(prefix="/api")


@router.get("/competitions", response_model=List[Competition])
async def list_competitions(season_id: Optional[str] = None, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.competitions.find(
        season_query(member_ids, season_id), {"_id": 0},
    ).sort("event_date", 1).to_list(500)
    return [Competition(**d) for d in docs]


@router.post("/competitions", response_model=Competition)
async def create_competition(payload: CompetitionCreate, current_user=Depends(get_current_user)):
    # exclude_none so unset Optional[List[...]] fields fall back to default_factory=list
    comp = Competition(user_id=current_user["id"], **payload.model_dump(exclude_none=True))
    await db.competitions.insert_one(comp.model_dump())
    return comp


@router.get("/competitions/{competition_id}", response_model=Competition)
async def get_competition(competition_id: str, current_user=Depends(get_current_user)):
    doc = await db.competitions.find_one(
        {"id": competition_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Competition not found")
    return Competition(**doc)


@router.patch("/competitions/{competition_id}", response_model=Competition)
async def update_competition(competition_id: str, payload: CompetitionUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    sent = payload.model_dump(exclude_unset=True)
    scope = sent.pop("edit_scope", None)
    updates = {k: v for k, v in sent.items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    doc = await apply_scoped_update(db.competitions, member_ids, competition_id, updates, scope)
    if doc is None:
        raise HTTPException(status_code=404, detail="Competition not found")
    return Competition(**doc)


@router.delete("/competitions/{competition_id}")
async def delete_competition(competition_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.competitions.delete_one(
        {"id": competition_id, "user_id": {"$in": member_ids}}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Competition not found")
    await db.bookings.delete_many({"competition_id": competition_id, "user_id": {"$in": member_ids}})
    return {"deleted": True}
