from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    SizeSheet,
    SizeColumn,
    SizeColumnCreate,
    SizeColumnUpdate,
    SizeValueUpdate,
    DEFAULT_SIZE_COLUMNS,
)
from core.security import get_current_user, require_team_access
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api/team", dependencies=[Depends(require_team_access)])


async def _get_or_create_sheet(current_user) -> dict:
    """One shared Sizes sheet per household. Seeds the default columns on first use."""
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.size_sheets.find_one({"user_id": {"$in": member_ids}}, {"_id": 0})
    if doc:
        return doc
    columns = [
        SizeColumn(label=label, is_default=True, order=i)
        for i, label in enumerate(DEFAULT_SIZE_COLUMNS)
    ]
    sheet = SizeSheet(user_id=current_user["id"], columns=columns)
    await db.size_sheets.insert_one(sheet.model_dump())
    return sheet.model_dump()


@router.get("/sizes", response_model=SizeSheet)
async def get_sizes(current_user=Depends(get_current_user)):
    doc = await _get_or_create_sheet(current_user)
    return SizeSheet(**doc)


@router.post("/sizes/columns", response_model=SizeSheet)
async def add_size_column(payload: SizeColumnCreate, current_user=Depends(get_current_user)):
    label = (payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Column name is required")
    doc = await _get_or_create_sheet(current_user)
    columns = doc.get("columns") or []
    order = max([c.get("order", 0) for c in columns], default=-1) + 1
    new_col = SizeColumn(label=label, is_default=False, order=order)
    columns.append(new_col.model_dump())
    await db.size_sheets.update_one({"id": doc["id"]}, {"$set": {"columns": columns}})
    doc["columns"] = columns
    return SizeSheet(**doc)


@router.patch("/sizes/columns/{col_id}", response_model=SizeSheet)
async def rename_size_column(col_id: str, payload: SizeColumnUpdate, current_user=Depends(get_current_user)):
    label = (payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Column name is required")
    doc = await _get_or_create_sheet(current_user)
    columns = doc.get("columns") or []
    found = False
    for c in columns:
        if c.get("id") == col_id:
            c["label"] = label
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Column not found")
    await db.size_sheets.update_one({"id": doc["id"]}, {"$set": {"columns": columns}})
    doc["columns"] = columns
    return SizeSheet(**doc)


@router.delete("/sizes/columns/{col_id}", response_model=SizeSheet)
async def delete_size_column(col_id: str, current_user=Depends(get_current_user)):
    doc = await _get_or_create_sheet(current_user)
    columns = [c for c in (doc.get("columns") or []) if c.get("id") != col_id]
    # Strip this column's values from every member.
    values = doc.get("values") or {}
    for mid in list(values.keys()):
        values[mid].pop(col_id, None)
    await db.size_sheets.update_one({"id": doc["id"]}, {"$set": {"columns": columns, "values": values}})
    doc["columns"] = columns
    doc["values"] = values
    return SizeSheet(**doc)


@router.put("/sizes/value", response_model=SizeSheet)
async def set_size_value(payload: SizeValueUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    # Ensure the member is on this household's roster.
    rm = await db.roster.find_one({"id": payload.member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
    if not rm:
        raise HTTPException(status_code=404, detail="Roster member not found")
    doc = await _get_or_create_sheet(current_user)
    if not any(c.get("id") == payload.column_id for c in (doc.get("columns") or [])):
        raise HTTPException(status_code=404, detail="Column not found")
    values = doc.get("values") or {}
    member_vals = values.get(payload.member_id) or {}
    val = (payload.value or "").strip()
    if val:
        member_vals[payload.column_id] = val
    else:
        member_vals.pop(payload.column_id, None)
    values[payload.member_id] = member_vals
    await db.size_sheets.update_one({"id": doc["id"]}, {"$set": {"values": values}})
    doc["values"] = values
    return SizeSheet(**doc)
