from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import uuid

from core.db import db
from core.models import (
    Fundraiser, FundraiserCreate, FundraiserUpdate,
)
from core.security import get_current_user
from core.helpers import _household_user_ids, _fundraiser_with_available

router = APIRouter(prefix="/api")


@router.get("/fundraisers", response_model=List[Fundraiser])
async def list_fundraisers(current_user=Depends(get_current_user)):
    docs = await db.fundraisers.find(
        {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
        {"_id": 0},
    ).sort("raised_on", -1).to_list(1000)
    return [_fundraiser_with_available(d) for d in docs]


@router.post("/fundraisers", response_model=Fundraiser)
async def create_fundraiser(payload: FundraiserCreate, current_user=Depends(get_current_user)):
    data = payload.model_dump()
    for k in ("available",):
        data.pop(k, None)
    fr = Fundraiser(user_id=current_user["id"], **data)
    stored = fr.model_dump()
    stored.pop("available", None)
    await db.fundraisers.insert_one(stored)
    fr.available = round(max(0.0, fr.amount_raised - fr.applied_amount), 2)
    return fr


@router.patch("/fundraisers/{fundraiser_id}", response_model=Fundraiser)
async def update_fundraiser(fundraiser_id: str, payload: FundraiserUpdate, current_user=Depends(get_current_user)):
    nullable_fields = {"athlete_id", "note", "goal_amount"}
    sent = payload.model_dump(exclude_unset=True)
    updates: dict = {}
    for k, v in sent.items():
        if v is None and k not in nullable_fields:
            continue
        updates[k] = v
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.fundraisers.update_one(
        {"id": fundraiser_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Fundraiser not found")
    doc = await db.fundraisers.find_one({"id": fundraiser_id}, {"_id": 0})
    return _fundraiser_with_available(doc)


@router.delete("/fundraisers/{fundraiser_id}")
async def delete_fundraiser(fundraiser_id: str, current_user=Depends(get_current_user)):
    res = await db.fundraisers.delete_one({
        "id": fundraiser_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}
    })
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fundraiser not found")
    return {"deleted": True}


class FundraiserShare(BaseModel):
    enabled: bool = True


@router.post("/fundraisers/{fundraiser_id}/share")
async def share_fundraiser(fundraiser_id: str, payload: FundraiserShare, current_user=Depends(get_current_user)):
    ids = await _household_user_ids(current_user["id"])
    doc = await db.fundraisers.find_one({"id": fundraiser_id, "user_id": {"$in": ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Fundraiser not found")
    if payload.enabled:
        token = doc.get("share_token") or uuid.uuid4().hex[:12]
        await db.fundraisers.update_one({"id": fundraiser_id}, {"$set": {"is_public": True, "share_token": token}})
        return {"is_public": True, "share_token": token}
    await db.fundraisers.update_one({"id": fundraiser_id}, {"$set": {"is_public": False}})
    return {"is_public": False, "share_token": doc.get("share_token")}


@router.get("/public/fundraisers/{token}")
async def public_fundraiser(token: str):
    """Unauthenticated read of a fundraiser that has been shared publicly."""
    doc = await db.fundraisers.find_one({"share_token": token, "is_public": True}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="This fundraiser link is not available.")
    raised = float(doc.get("amount_raised") or 0)
    applied = float(doc.get("applied_amount") or 0)
    return {
        "name": doc.get("name"),
        "amount_raised": round(raised, 2),
        "applied_amount": round(applied, 2),
        "available": round(max(0.0, raised - applied), 2),
        "goal_amount": doc.get("goal_amount"),
        "raised_on": doc.get("raised_on"),
        "note": doc.get("note"),
    }
