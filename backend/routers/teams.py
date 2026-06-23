from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import Team, TeamCreate, TeamUpdate
from core.security import get_current_user
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api")


@router.get("/teams", response_model=List[Team])
async def list_teams(current_user=Depends(get_current_user)):
    docs = await db.teams.find(
        {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    return [Team(**d) for d in docs]


@router.post("/teams", response_model=Team)
async def create_team(payload: TeamCreate, current_user=Depends(get_current_user)):
    team = Team(user_id=current_user["id"], **payload.model_dump(exclude_none=True))
    await db.teams.insert_one(team.model_dump())
    return team


@router.patch("/teams/{team_id}", response_model=Team)
async def update_team(team_id: str, payload: TeamUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.teams.update_one(
        {"id": team_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}},
        {"$set": updates},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Team not found")
    doc = await db.teams.find_one({"id": team_id}, {"_id": 0})
    return Team(**doc)


@router.delete("/teams/{team_id}")
async def delete_team(team_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.teams.delete_one({"id": team_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Team not found")
    # Detach team from athletes & competitions in this household
    await db.athletes.update_many(
        {"user_id": {"$in": member_ids}, "team_ids": team_id},
        {"$pull": {"team_ids": team_id}},
    )
    await db.competitions.update_many(
        {"user_id": {"$in": member_ids}, "team_ids": team_id},
        {"$pull": {"team_ids": team_id}},
    )
    # Also strip per-team meet-time entries
    await db.competitions.update_many(
        {"user_id": {"$in": member_ids}},
        {"$pull": {"team_meet_times": {"team_id": team_id}}},
    )
    return {"deleted": True}
