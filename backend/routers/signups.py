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
    SignupReorderPayload,
    utcnow_iso,
)
from core.security import get_current_user, require_team_access
from core.helpers import _team_hub_scope_user_ids as _household_user_ids, _blocked_resource_ids
from core.gating import assert_under_count, assert_premium
from core.sms import send_sms, is_configured, normalize_us_phone, join_links

router = APIRouter(prefix="/api/team", dependencies=[Depends(require_team_access)])


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
async def list_signups(event_id: str | None = None, competition_id: str | None = None, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    query: dict = {"user_id": {"$in": member_ids}}
    if event_id:
        query["event_ids"] = event_id
    if competition_id:
        query["competition_ids"] = competition_id
    docs = await db.signup_sheets.find(query, {"_id": 0}).to_list(1000)
    blocked = await _blocked_resource_ids(current_user["id"], "signup")
    docs = [d for d in docs if d["id"] not in blocked]
    docs.sort(key=lambda d: (d.get("order", 0), d.get("created_at") or ""))
    return [{**SignupSheet(**d).model_dump(), "summary": _summary(d)} for d in docs]


@router.post("/signups", response_model=SignupSheet)
async def create_signup(payload: SignupSheetCreate, current_user=Depends(get_current_user)):
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="Name is required")
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.signup_sheets.find({"user_id": {"$in": member_ids}}, {"_id": 0, "order": 1}).to_list(1000)
    await assert_under_count(current_user["id"], "team_hub_signup_sheets", len(existing))
    order = min([s.get("order", 0) for s in existing], default=1) - 1  # new sheet floats to the top
    sheet = SignupSheet(user_id=current_user["id"], name=payload.name.strip(),
                        links=[l.model_dump() for l in (payload.links or [])],
                        competition_ids=payload.competition_ids or [], event_ids=payload.event_ids or [], order=order)
    await db.signup_sheets.insert_one(sheet.model_dump())
    return sheet


@router.post("/signups/reorder")
async def reorder_signups(payload: SignupReorderPayload, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    for idx, sid in enumerate(payload.ids):
        await db.signup_sheets.update_one(
            {"id": sid, "user_id": {"$in": member_ids}}, {"$set": {"order": idx}}
        )
    return {"ok": True}


@router.get("/signups/{sheet_id}")
async def get_signup(sheet_id: str, current_user=Depends(get_current_user)):
    if sheet_id in await _blocked_resource_ids(current_user["id"], "signup"):
        raise HTTPException(status_code=403, detail="You don't have access to this sheet")
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
    if payload.links is not None:
        updates["links"] = [l.model_dump() for l in payload.links]
    if payload.competition_ids is not None:
        updates["competition_ids"] = payload.competition_ids
    if payload.event_ids is not None:
        updates["event_ids"] = payload.event_ids
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


@router.post("/signups/{sheet_id}/duplicate", response_model=SignupSheet)
async def duplicate_signup(sheet_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.signup_sheets.find_one({"id": sheet_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sign-up sheet not found")
    # Copy the slot structure with fresh ids and NO claims (a clean sheet to fill).
    slots = [
        SignupSlot(label=s["label"], kind=s.get("kind", "item"), time_label=s.get("time_label"),
                   qty_needed=s.get("qty_needed", 1), order=s.get("order", 0))
        for s in (doc.get("slots") or [])
    ]
    copy = SignupSheet(user_id=current_user["id"], name=f"{doc.get('name')} (copy)",
                       links=list(doc.get("links") or []),
                       competition_ids=doc.get("competition_ids") or [], event_ids=doc.get("event_ids") or [],
                       order=doc.get("order", 0) - 1, slots=slots)
    await db.signup_sheets.insert_one(copy.model_dump())
    return copy


@router.post("/signups/{sheet_id}/remind")
async def remind_signup(sheet_id: str, current_user=Depends(get_current_user)):
    """Text roster members who haven't claimed any slot on this sheet, with the
    sheet's link(s) so they can sign up."""
    await assert_premium(current_user["id"], "mass_sms_reminders")
    if not is_configured():
        raise HTTPException(status_code=400, detail="SMS isn't configured. Add your Twilio number in settings.")
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.signup_sheets.find_one({"id": sheet_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sign-up sheet not found")

    sheet_name = doc.get("name") or "sign-up"
    links = doc.get("links") or []
    links_txt = (" Sign up here: " + join_links(links)) if join_links(links) else ""

    # Roster member ids that already claimed at least one slot.
    claimed_ids = set()
    for s in (doc.get("slots") or []):
        for c in (s.get("claims") or []):
            if c.get("member_id"):
                claimed_ids.add(c["member_id"])

    roster = await db.roster.find(
        {"user_id": {"$in": member_ids}, "role": {"$ne": "parent"}}, {"_id": 0}
    ).to_list(2000)

    sent, no_phone, failed = 0, [], []
    for m in roster:
        if m["id"] in claimed_ids:
            continue  # already signed up
        phone = (m.get("parent_phone") or m.get("phone")) if m.get("role") == "athlete" else (m.get("phone") or m.get("parent_phone"))
        if not normalize_us_phone(phone):
            no_phone.append(m.get("name"))
            continue
        first = (m.get("first_name") or (m.get("name") or "").split(" ")[0] or "there")
        body = f"Hi {first}, please sign up for '{sheet_name}'.{links_txt} Thank you!"
        if send_sms(phone, body):
            sent += 1
        else:
            failed.append(m.get("name"))
    if sent > 0:
        await db.signup_sheets.update_one({"id": sheet_id}, {"$set": {"last_reminded_at": utcnow_iso()}})
    return {"sent": sent, "no_phone": no_phone, "failed": failed}


@router.post("/signups/{sheet_id}/slots", response_model=SignupSheet)
async def add_slot(sheet_id: str, payload: SignupSlotCreate, current_user=Depends(get_current_user)):
    label = (payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Slot name is required")
    doc = await _get_sheet(sheet_id, current_user)
    slots = doc.get("slots") or []
    order = max([s.get("order", 0) for s in slots], default=-1) + 1
    slots.append(SignupSlot(
        label=label,
        kind=payload.kind or "item",
        time_label=(payload.time_label or None),
        qty_needed=max(1, int(payload.qty_needed or 1)),
        order=order,
    ).model_dump())
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
    if payload.kind is not None:
        slot["kind"] = payload.kind
    if payload.time_label is not None:
        slot["time_label"] = payload.time_label.strip() or None
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
