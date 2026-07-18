from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    RosterMember,
    RosterMemberCreate,
    RosterMemberUpdate,
    RosterImportPayload,
)
from core.security import get_current_user
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api")


@router.get("/roster", response_model=List[RosterMember])
async def list_roster(current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.roster.find(
        {"user_id": {"$in": member_ids}}, {"_id": 0}
    ).to_list(1000)
    docs.sort(key=lambda d: (d.get("name") or "").lower())
    return [RosterMember(**d) for d in docs]


@router.post("/roster", response_model=RosterMember)
async def create_roster_member(payload: RosterMemberCreate, current_user=Depends(get_current_user)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    member = RosterMember(user_id=current_user["id"], **payload.model_dump(exclude_none=True))
    member.name = name
    await db.roster.insert_one(member.model_dump())
    return member


@router.patch("/roster/{member_id}", response_model=RosterMember)
async def update_roster_member(member_id: str, payload: RosterMemberUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.roster.update_one(
        {"id": member_id, "user_id": {"$in": member_ids}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Roster member not found")
    doc = await db.roster.find_one({"id": member_id}, {"_id": 0})
    return RosterMember(**doc)


@router.delete("/roster/{member_id}")
async def delete_roster_member(member_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.roster.delete_one({"id": member_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Roster member not found")
    return {"deleted": True}


@router.get("/roster/import-candidates")
async def roster_import_candidates(current_user=Depends(get_current_user)):
    """People we can pull into the roster in one tap: household athletes and
    household members (users). Excludes anyone already imported (by linked_id)."""
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.roster.find(
        {"user_id": {"$in": member_ids}, "linked_id": {"$ne": None}},
        {"_id": 0, "linked_id": 1},
    ).to_list(1000)
    linked = {d["linked_id"] for d in existing if d.get("linked_id")}

    athletes = []
    async for a in db.athletes.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1, "role": 1, "team_ids": 1}):
        if a["id"] in linked:
            continue
        team_ids = a.get("team_ids") or []
        athletes.append({
            "id": a["id"],
            "name": a.get("name"),
            "role": a.get("role") or "athlete",
            "team_id": team_ids[0] if team_ids else None,
        })

    members = []
    h = await db.households.find_one({"member_user_ids": current_user["id"]}, {"_id": 0})
    hu_ids = (h or {}).get("member_user_ids", [current_user["id"]])
    async for u in db.users.find({"id": {"$in": hu_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}):
        if u["id"] in linked:
            continue
        members.append({"id": u["id"], "name": u.get("name") or (u.get("email") or "").split("@")[0], "email": u.get("email")})

    return {"athletes": athletes, "members": members}


@router.post("/roster/import", response_model=List[RosterMember])
async def roster_import(payload: RosterImportPayload, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    # Guard against duplicates.
    existing = await db.roster.find(
        {"user_id": {"$in": member_ids}, "linked_id": {"$ne": None}},
        {"_id": 0, "linked_id": 1},
    ).to_list(1000)
    linked = {d["linked_id"] for d in existing if d.get("linked_id")}

    created: List[RosterMember] = []

    if payload.athlete_ids:
        async for a in db.athletes.find(
            {"user_id": {"$in": member_ids}, "id": {"$in": payload.athlete_ids}}, {"_id": 0}
        ):
            if a["id"] in linked:
                continue
            role = a.get("role") if a.get("role") in ("athlete", "coach", "team_rep", "staff") else "athlete"
            team_ids = a.get("team_ids") or []
            m = RosterMember(
                user_id=current_user["id"], name=a.get("name") or "Athlete", role=role,
                team_id=team_ids[0] if team_ids else None, source="athlete", linked_id=a["id"],
            )
            created.append(m)

    if payload.member_user_ids:
        async for u in db.users.find(
            {"id": {"$in": payload.member_user_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}
        ):
            if u["id"] in linked:
                continue
            m = RosterMember(
                user_id=current_user["id"],
                name=u.get("name") or (u.get("email") or "Member").split("@")[0],
                role="parent", email=u.get("email"), source="household", linked_id=u["id"],
            )
            created.append(m)

    if created:
        await db.roster.insert_many([m.model_dump() for m in created])
    return created
