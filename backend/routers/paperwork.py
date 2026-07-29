from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    PaperworkSheet,
    PaperworkItem,
    PaperworkSheetCreate,
    PaperworkSheetUpdate,
    PaperworkItemCreate,
    PaperworkItemUpdate,
    PaperworkValueUpdate,
)
from core.security import get_current_user, require_team_access
from core.helpers import _team_hub_scope_user_ids as _household_user_ids, _blocked_resource_ids
from core.gating import assert_premium
from core.sms import send_sms, is_configured, normalize_us_phone, join_links

router = APIRouter(prefix="/api/team", dependencies=[Depends(require_team_access)])


async def _roster_total(member_ids: List[str]) -> int:
    return await db.roster.count_documents({"user_id": {"$in": member_ids}, "role": {"$ne": "parent"}})


def _summary(sheet: dict, roster_total: int) -> dict:
    items = sheet.get("items") or []
    item_count = len(items)
    values = sheet.get("values") or {}
    done_cells = 0
    for mid, per_item in values.items():
        for _iid, cell in (per_item or {}).items():
            if cell and cell.get("done"):
                done_cells += 1
    total_cells = item_count * roster_total
    pct = round((done_cells / total_cells) * 100) if total_cells > 0 else 0
    return {"item_count": item_count, "member_total": roster_total, "done_cells": done_cells, "total_cells": total_cells, "pct": pct}


async def _get_sheet(sheet_id: str, current_user) -> dict:
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.paperwork_sheets.find_one({"id": sheet_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sheet not found")
    return doc


@router.get("/paperwork")
async def list_paperwork(current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.paperwork_sheets.find({"user_id": {"$in": member_ids}}, {"_id": 0}).to_list(1000)
    blocked = await _blocked_resource_ids(current_user["id"], "paperwork")
    docs = [d for d in docs if d["id"] not in blocked]
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    roster_total = await _roster_total(member_ids)
    return [{**PaperworkSheet(**d).model_dump(), "summary": _summary(d, roster_total)} for d in docs]


@router.post("/paperwork", response_model=PaperworkSheet)
async def create_paperwork(payload: PaperworkSheetCreate, current_user=Depends(get_current_user)):
    await assert_premium(current_user["id"], "paperwork")
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="Name is required")
    sheet = PaperworkSheet(user_id=current_user["id"], name=payload.name.strip())
    await db.paperwork_sheets.insert_one(sheet.model_dump())
    return sheet


@router.get("/paperwork/{sheet_id}")
async def get_paperwork(sheet_id: str, current_user=Depends(get_current_user)):
    if sheet_id in await _blocked_resource_ids(current_user["id"], "paperwork"):
        raise HTTPException(status_code=403, detail="You don't have access to this sheet")
    member_ids = await _household_user_ids(current_user["id"])
    doc = await _get_sheet(sheet_id, current_user)
    roster_total = await _roster_total(member_ids)
    return {**PaperworkSheet(**doc).model_dump(), "summary": _summary(doc, roster_total)}


@router.patch("/paperwork/{sheet_id}", response_model=PaperworkSheet)
async def rename_paperwork(sheet_id: str, payload: PaperworkSheetUpdate, current_user=Depends(get_current_user)):
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="Name cannot be blank")
    doc = await _get_sheet(sheet_id, current_user)
    await db.paperwork_sheets.update_one({"id": doc["id"]}, {"$set": {"name": payload.name.strip()}})
    doc["name"] = payload.name.strip()
    return PaperworkSheet(**doc)


@router.delete("/paperwork/{sheet_id}")
async def delete_paperwork(sheet_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.paperwork_sheets.delete_one({"id": sheet_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sheet not found")
    return {"deleted": True}


@router.post("/paperwork/{sheet_id}/duplicate", response_model=PaperworkSheet)
async def duplicate_paperwork(sheet_id: str, current_user=Depends(get_current_user)):
    await assert_premium(current_user["id"], "paperwork")
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.paperwork_sheets.find_one({"id": sheet_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sheet not found")
    # Copy the columns (items) with fresh ids; start with no checkmarks.
    items = [PaperworkItem(label=it["label"], order=it.get("order", i), links=list(it.get("links") or [])).model_dump()
             for i, it in enumerate(doc.get("items") or [])]
    copy = PaperworkSheet(user_id=current_user["id"], name=f"{doc.get('name')} (copy)", items=items)
    await db.paperwork_sheets.insert_one(copy.model_dump())
    return copy


@router.post("/paperwork/{sheet_id}/items", response_model=PaperworkSheet)
async def add_item(sheet_id: str, payload: PaperworkItemCreate, current_user=Depends(get_current_user)):
    label = (payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Item name is required")
    doc = await _get_sheet(sheet_id, current_user)
    items = doc.get("items") or []
    order = max([i.get("order", 0) for i in items], default=-1) + 1
    links = [l.model_dump() for l in (payload.links or [])]
    items.append(PaperworkItem(label=label, order=order, links=links).model_dump())
    await db.paperwork_sheets.update_one({"id": doc["id"]}, {"$set": {"items": items}})
    doc["items"] = items
    return PaperworkSheet(**doc)


@router.patch("/paperwork/{sheet_id}/items/{item_id}", response_model=PaperworkSheet)
async def rename_item(sheet_id: str, item_id: str, payload: PaperworkItemUpdate, current_user=Depends(get_current_user)):
    doc = await _get_sheet(sheet_id, current_user)
    items = doc.get("items") or []
    found = False
    for i in items:
        if i.get("id") == item_id:
            if payload.label is not None:
                label = (payload.label or "").strip()
                if not label:
                    raise HTTPException(status_code=400, detail="Item name is required")
                i["label"] = label
            if payload.links is not None:
                i["links"] = [l.model_dump() for l in payload.links]
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.paperwork_sheets.update_one({"id": doc["id"]}, {"$set": {"items": items}})
    doc["items"] = items
    return PaperworkSheet(**doc)


@router.delete("/paperwork/{sheet_id}/items/{item_id}", response_model=PaperworkSheet)
async def delete_item(sheet_id: str, item_id: str, current_user=Depends(get_current_user)):
    doc = await _get_sheet(sheet_id, current_user)
    items = [i for i in (doc.get("items") or []) if i.get("id") != item_id]
    values = doc.get("values") or {}
    for mid in list(values.keys()):
        values[mid].pop(item_id, None)
    await db.paperwork_sheets.update_one({"id": doc["id"]}, {"$set": {"items": items, "values": values}})
    doc["items"] = items
    doc["values"] = values
    return PaperworkSheet(**doc)


@router.post("/paperwork/{sheet_id}/items/{item_id}/remind")
async def remind_missing_item(sheet_id: str, item_id: str, current_user=Depends(get_current_user)):
    """Text each roster member who has NOT completed this item, including the
    item's link(s) so they can act right away."""
    await assert_premium(current_user["id"], "mass_sms_reminders")
    if not is_configured():
        raise HTTPException(status_code=400, detail="SMS isn't configured. Add your Twilio number in settings.")
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.paperwork_sheets.find_one({"id": sheet_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sheet not found")
    item = next((i for i in (doc.get("items") or []) if i.get("id") == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    sheet_name = doc.get("name") or "paperwork"
    item_label = item.get("label") or "an item"
    links = item.get("links") or []
    links_txt = (" Complete it here: " + join_links(links)) if join_links(links) else ""
    values = doc.get("values") or {}

    roster = await db.roster.find(
        {"user_id": {"$in": member_ids}, "role": {"$ne": "parent"}}, {"_id": 0}
    ).to_list(2000)

    sent, no_phone, failed = 0, [], []
    for m in roster:
        cell = (values.get(m["id"]) or {}).get(item_id) or {}
        if cell.get("done"):
            continue  # already completed
        phone = (m.get("parent_phone") or m.get("phone")) if m.get("role") == "athlete" else (m.get("phone") or m.get("parent_phone"))
        if not normalize_us_phone(phone):
            no_phone.append(m.get("name"))
            continue
        first = (m.get("first_name") or (m.get("name") or "").split(" ")[0] or "there")
        body = f"Hi {first}, reminder: '{item_label}' for {sheet_name} is still needed.{links_txt} Thank you!"
        if send_sms(phone, body):
            sent += 1
        else:
            failed.append(m.get("name"))
    return {"sent": sent, "no_phone": no_phone, "failed": failed}


@router.put("/paperwork/{sheet_id}/value", response_model=PaperworkSheet)
async def set_value(sheet_id: str, payload: PaperworkValueUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    rm = await db.roster.find_one({"id": payload.member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
    if not rm:
        raise HTTPException(status_code=404, detail="Roster member not found")
    doc = await _get_sheet(sheet_id, current_user)
    if not any(i.get("id") == payload.item_id for i in (doc.get("items") or [])):
        raise HTTPException(status_code=404, detail="Item not found")
    values = doc.get("values") or {}
    per_item = values.get(payload.member_id) or {}
    cell = per_item.get(payload.item_id) or {"done": False, "note": None}
    if payload.done is not None:
        cell["done"] = bool(payload.done)
    if payload.note is not None:
        note = payload.note.strip()
        cell["note"] = note or None
    per_item[payload.item_id] = cell
    values[payload.member_id] = per_item
    await db.paperwork_sheets.update_one({"id": doc["id"]}, {"$set": {"values": values}})
    doc["values"] = values
    return PaperworkSheet(**doc)
