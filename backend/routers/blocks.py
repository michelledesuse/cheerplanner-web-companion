"""Team Hub — per-sheet access blocks. The household OWNER can hide a specific
sheet/tracker (payment, paperwork, sign-up, attendance) from an individual
granted user (e.g. hide the "coach's gift" tracker from the coach).
"""
from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import SheetBlock, SheetBlockCreate
from core.security import get_current_user, require_team_access
from core.helpers import _get_or_create_household, _household_owner_id

router = APIRouter(prefix="/api/team", dependencies=[Depends(require_team_access)])


@router.get("/blocks/{resource}/{resource_id}")
async def get_blocks(resource: str, resource_id: str, current_user=Depends(get_current_user)):
    """Owner-only management view: household members (excluding owner) with a
    flag for whether each is blocked from this resource."""
    h = await _get_or_create_household(current_user["id"])
    owner_id = _household_owner_id(h)
    is_owner = owner_id == current_user["id"]
    if not is_owner:
        return {"is_owner": False, "members": [], "blocked_user_ids": []}

    blocked = await db.sheet_blocks.find(
        {"user_id": owner_id, "resource": resource, "resource_id": resource_id},
        {"_id": 0, "blocked_user_id": 1},
    ).to_list(1000)
    blocked_ids = [b["blocked_user_id"] for b in blocked]

    members = []
    async for u in db.users.find(
        {"id": {"$in": h.get("member_user_ids", [])}},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "team_access": 1},
    ):
        if u["id"] == owner_id:
            continue  # owner always has access
        members.append({
            "id": u["id"], "email": u.get("email"), "name": u.get("name"),
            "team_access": bool(u.get("team_access")),
            "blocked": u["id"] in blocked_ids,
        })
    return {"is_owner": True, "members": members, "blocked_user_ids": blocked_ids}


@router.put("/blocks")
async def set_block(payload: SheetBlockCreate, blocked: bool = True, current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    owner_id = _household_owner_id(h)
    if owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Only the account owner can manage sheet access")
    if payload.blocked_user_id not in (h.get("member_user_ids") or []):
        raise HTTPException(status_code=404, detail="That member isn't in your household")
    key = {"user_id": owner_id, "blocked_user_id": payload.blocked_user_id,
           "resource": payload.resource, "resource_id": payload.resource_id}
    if blocked:
        existing = await db.sheet_blocks.find_one(key, {"_id": 0, "id": 1})
        if not existing:
            await db.sheet_blocks.insert_one(SheetBlock(**key).model_dump())
        return {"blocked": True}
    await db.sheet_blocks.delete_many(key)
    return {"blocked": False}
