from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    SignupSheet,
    SignupSlot,
    SignupClaim,
    SignupSheetCreate,
    SignupSheetUpdate,
    SignupSlotCreate,
    SignupSlotUpdate,
    SignupClaimCreate,
)
from core.security import get_current_user
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api/team")


def _summary(sheet: dict) -> dict:
    slots = sheet.get("slots") or []
    needed = sum(int(s.get("qty_needed") or 0) for s in slots)
    claimed = 0
    for s in slots:
        for cl in (s.get("claims") or []):
            claimed += int(cl.get("qty") or 0)
    filled_slots = sum(1 for s in slots if sum(int(c.get("qty") or 0) for c in (s.get("claims") or [])) >= int(s.get("qty_needed") or 0) and int(s.get("qty_needed") or 0) > 0)
    return {"slot_count": len(slots), "needed_total": needed, "claimed_total": claimed, "filled_slots": filled_slots}


async def _get_sheet(sheet_id: str, current_user) -> dict:
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.signup_sheets.find_one({"id": sheet_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sign-up sheet not found")
    return doc


@router.get("/signups")
async def list_signups(current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.signup_sheets.find({"user_id": {"$in": member_ids}}, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    return [{**SignupSheet(**d).model_dump(), "summary": _summary(d)} for d in docs]


@router.post("/signups", response_model=SignupSheet)
async def create_signup(payload: SignupSheetCreate, current_user=Depends(get_current_user)):
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="Name is required")
    sheet = SignupSheet(user_id=current_user["id"], name=payload.name.strip(), competition_id=payload.competition_id)
    await db.signup_sheets.insert_one(sheet.model_dump())
    return sheet


@router.get("/signups/{sheet_id}")
async def get_signup(sheet_id: str, current_user=Depends(get_current_user)):
    doc = await _get_sheet(sheet_id, current_user)
    return {**SignupSheet(**doc).model_dump(), "summary": _summary(doc)}


@router.patch("/signups/{sheet_id}", response_model=SignupSheet)
async def update_signup(sheet_id: str, payload: SignupSheetUpdate, current_user=Depends(get_current_user)):
    doc = await _get_sheet(sheet_id, current_user)
    updates = {}
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Name cannot be blank")
        updates["name"] = payload.name.strip()
    if payload.competition_id is not None:
        updates["competition_id"] = payload.competition_id or None
    if updates:
        await db.signup_sheets.update_one({"id": doc["id"]}, {"$set": updates})
        doc.update(updates)
    return SignupSheet(**doc)


@router.delete("/signups/{sheet_id}")
async def delete_signup(sheet_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.signup_sheets.delete_one({"id": sheet_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sign-up sheet not found")
    return {"deleted": True}


@router.post("/signups/{sheet_id}/slots", response_model=SignupSheet)
async def add_slot(sheet_id: str, payload: SignupSlotCreate, current_user=Depends(get_current_user)):
    label = (payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Slot name is required")
    doc = await _get_sheet(sheet_id, current_user)
    slots = doc.get("slots") or []
    order = max([s.get("order", 0) for s in slots], default=-1) + 1
    slots.append(SignupSlot(label=label, qty_needed=max(1, int(payload.qty_needed or 1)), order=order).model_dump())
    await db.signup_sheets.update_one({"id": doc["id"]}, {"$set": {"slots": slots}})
    doc["slots"] = slots
    return SignupSheet(**doc)


@router.patch("/signups/{sheet_id}/slots/{slot_id}", response_model=SignupSheet)
async def update_slot(sheet_id: str, slot_id: str, payload: SignupSlotUpdate, current_user=Depends(get_current_user)):
    doc = await _get_sheet(sheet_id, current_user)
    slots = doc.get("slots") or []
    slot = next((s for s in slots if s.get("id") == slot_id), None)
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    if payload.label is not None:
        if not payload.label.strip():
            raise HTTPException(status_code=400, detail="Slot name cannot be blank")
        slot["label"] = payload.label.strip()
    if payload.qty_needed is not None:
        slot["qty_needed"] = max(1, int(payload.qty_needed))
    await db.signup_sheets.update_one({"id": doc["id"]}, {"$set": {"slots": slots}})
    doc["slots"] = slots
    return SignupSheet(**doc)


@router.delete("/signups/{sheet_id}/slots/{slot_id}", response_model=SignupSheet)
async def delete_slot(sheet_id: str, slot_id: str, current_user=Depends(get_current_user)):
    doc = await _get_sheet(sheet_id, current_user)
    slots = [s for s in (doc.get("slots") or []) if s.get("id") != slot_id]
    await db.signup_sheets.update_one({"id": doc["id"]}, {"$set": {"slots": slots}})
    doc["slots"] = slots
    return SignupSheet(**doc)


@router.post("/signups/{sheet_id}/slots/{slot_id}/claims", response_model=SignupSheet)
async def add_claim(sheet_id: str, slot_id: str, payload: SignupClaimCreate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    rm = await db.roster.find_one({"id": payload.member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
    if not rm:
        raise HTTPException(status_code=404, detail="Roster member not found")
    doc = await _get_sheet(sheet_id, current_user)
    slots = doc.get("slots") or []
    slot = next((s for s in slots if s.get("id") == slot_id), None)
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    claims = slot.get("claims") or []
    claims.append(SignupClaim(member_id=payload.member_id, qty=max(1, int(payload.qty or 1)), note=(payload.note or None)).model_dump())
    slot["claims"] = claims
    await db.signup_sheets.update_one({"id": doc["id"]}, {"$set": {"slots": slots}})
    doc["slots"] = slots
    return SignupSheet(**doc)


@router.delete("/signups/{sheet_id}/slots/{slot_id}/claims/{claim_id}", response_model=SignupSheet)
async def delete_claim(sheet_id: str, slot_id: str, claim_id: str, current_user=Depends(get_current_user)):
    doc = await _get_sheet(sheet_id, current_user)
    slots = doc.get("slots") or []
    slot = next((s for s in slots if s.get("id") == slot_id), None)
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    slot["claims"] = [c for c in (slot.get("claims") or []) if c.get("id") != claim_id]
    await db.signup_sheets.update_one({"id": doc["id"]}, {"$set": {"slots": slots}})
    doc["slots"] = slots
    return SignupSheet(**doc)
