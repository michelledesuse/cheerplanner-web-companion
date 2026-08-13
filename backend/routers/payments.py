from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    PaymentEntry, PaymentCreate, PaymentUpdate, PaymentBulkCreate, PaymentAllocation,
)
from core.security import get_current_user, require_visibility
from core.helpers import (
    _household_user_ids, _waterfall_allocations, _refresh_expense_paid_flags, season_query,
)

router = APIRouter(prefix="/api")


@router.get("/payments", response_model=List[PaymentEntry])
async def list_payments(athlete_id: Optional[str] = None, season_id: Optional[str] = None, current_user=Depends(require_visibility("expenses"))):
    q = season_query(await _household_user_ids(current_user["id"]), season_id)
    if athlete_id:
        q["athlete_id"] = athlete_id
    docs = await db.payments.find(q, {"_id": 0}).sort("paid_on", -1).to_list(2000)
    return [PaymentEntry(**d) for d in docs]


@router.post("/payments", response_model=PaymentEntry)
async def create_payment(payload: PaymentCreate, current_user=Depends(require_visibility("expenses"))):
    entry = PaymentEntry(user_id=current_user["id"], **payload.model_dump(exclude_none=True))
    # If caller picked expenses but didn't supply explicit allocations,
    # waterfall-allocate in due-date order so each expense gets paid IN FULL.
    if entry.applied_expense_ids and not entry.allocations:
        entry.allocations = await _waterfall_allocations(
            current_user["id"], float(entry.amount or 0), entry.applied_expense_ids
        )
    await db.payments.insert_one(entry.model_dump())
    # Reconcile paid flag for every expense this payment touched.
    affected_ids = set(entry.applied_expense_ids or [])
    for a in (entry.allocations or []):
        if isinstance(a, PaymentAllocation):
            affected_ids.add(a.expense_id)
        elif isinstance(a, dict) and a.get("expense_id"):
            affected_ids.add(a["expense_id"])
    await _refresh_expense_paid_flags(current_user["id"], affected_ids)
    return entry


@router.post("/payments/bulk", response_model=List[PaymentEntry])
async def create_payments_bulk(payload: PaymentBulkCreate, current_user=Depends(require_visibility("expenses"))):
    user_id = current_user["id"]
    if not payload.athlete_ids:
        raise HTTPException(status_code=400, detail="Select at least one athlete")
    if payload.amount is None or payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    valid_ids = {
        d["id"] async for d in db.athletes.find(
            {"id": {"$in": payload.athlete_ids}, "user_id": user_id}, {"_id": 0, "id": 1}
        )
    }
    missing = [aid for aid in payload.athlete_ids if aid not in valid_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"Athlete(s) not found: {missing}")
    per_amt = (
        round(payload.amount / len(payload.athlete_ids), 2)
        if payload.split_mode == "equal" else round(payload.amount, 2)
    )
    if per_amt <= 0:
        raise HTTPException(status_code=400, detail="Per-athlete amount must be greater than zero")

    # Bulk payments are NOT auto-allocated to expenses. User must explicitly
    # pick which expenses each payment covers.
    created: List[PaymentEntry] = []
    docs: List[dict] = []
    for aid in payload.athlete_ids:
        entry = PaymentEntry(
            user_id=user_id,
            athlete_id=aid,
            amount=per_amt,
            paid_on=payload.paid_on,
            method=payload.method,
            note=payload.note,
            applied_expense_ids=[],
            allocations=None,
            season_ids=payload.season_ids or [],
        )
        docs.append(entry.model_dump())
        created.append(entry)
    if docs:
        await db.payments.insert_many(docs)
    return created


@router.patch("/payments/{payment_id}", response_model=PaymentEntry)
async def update_payment(payment_id: str, payload: PaymentUpdate, current_user=Depends(require_visibility("expenses"))):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    # Snapshot existing expense ids/allocations BEFORE we touch the row.
    existing = await db.payments.find_one(
        {"id": payment_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}},
        {"_id": 0, "amount": 1, "applied_expense_ids": 1, "allocations": 1},
    ) or {}
    prev_expense_ids = set(existing.get("applied_expense_ids") or [])
    prev_expense_ids.update(
        a.get("expense_id") for a in (existing.get("allocations") or [])
        if isinstance(a, dict) and a.get("expense_id")
    )

    # Rebuild waterfall if expenses or amount changed (unless caller provided explicit allocations).
    if ("applied_expense_ids" in updates or "amount" in updates) and "allocations" not in updates:
        applied_ids = updates.get("applied_expense_ids", existing.get("applied_expense_ids") or [])
        new_amount = float(updates.get("amount", existing.get("amount") or 0.0))
        if applied_ids:
            allocs = await _waterfall_allocations(
                current_user["id"], new_amount, applied_ids, ignore_payment_id=payment_id,
            )
            updates["allocations"] = [a.model_dump() for a in allocs]
        else:
            updates["allocations"] = None
    elif "allocations" in updates and isinstance(updates["allocations"], list):
        updates["allocations"] = [
            (a if isinstance(a, dict) else a.model_dump()) for a in updates["allocations"]
        ]

    res = await db.payments.update_one(
        {"id": payment_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Payment not found")
    # Refresh expense.paid flags for the union of (previously covered) and (now covered) expenses
    affected_ids = set(prev_expense_ids)
    affected_ids.update(updates.get("applied_expense_ids") or [])
    affected_ids.update(
        a["expense_id"] for a in (updates.get("allocations") or []) if isinstance(a, dict)
    )
    await _refresh_expense_paid_flags(current_user["id"], affected_ids)

    doc = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    return PaymentEntry(**doc)


@router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, current_user=Depends(require_visibility("expenses"))):
    member_ids = await _household_user_ids(current_user["id"])
    # Snapshot which expenses this payment touched BEFORE deleting it.
    doc = await db.payments.find_one(
        {"id": payment_id, "user_id": {"$in": member_ids}},
        {"_id": 0, "applied_expense_ids": 1, "allocations": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Payment not found")
    affected_ids = set(doc.get("applied_expense_ids") or [])
    for a in (doc.get("allocations") or []):
        if isinstance(a, dict) and a.get("expense_id"):
            affected_ids.add(a["expense_id"])
    res = await db.payments.delete_one({"id": payment_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Payment not found")
    await _refresh_expense_paid_flags(current_user["id"], affected_ids)
    return {"deleted": True}
