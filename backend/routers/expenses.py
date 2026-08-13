import uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    ExpenseEntry, ExpenseCreate, ExpenseUpdate, ExpenseBulkCreate,
    PaymentEntry, PaymentAllocation,
    ApplyPaymentRequest,
    EXPENSE_CATEGORIES,
)
from core.security import get_current_user, require_visibility
from core.helpers import (
    _household_user_ids, _build_paid_map, _expense_with_balance, season_query,
)

router = APIRouter(prefix="/api")


@router.get("/expenses/categories")
async def expense_categories():
    return {"categories": EXPENSE_CATEGORIES}


@router.get("/expenses", response_model=List[ExpenseEntry])
async def list_expenses(
    athlete_id: Optional[str] = None,
    season_id: Optional[str] = None,
    current_user=Depends(require_visibility("expenses")),
):
    q = season_query(await _household_user_ids(current_user["id"]), season_id)
    if athlete_id:
        q["athlete_id"] = athlete_id
    docs = await db.expenses.find(q, {"_id": 0}).sort([("incurred_on", 1), ("created_at", 1)]).to_list(2000)
    paid_map = await _build_paid_map(current_user["id"])
    return [_expense_with_balance(d, paid_map) for d in docs]


@router.post("/expenses", response_model=List[ExpenseEntry])
async def create_expense(payload: ExpenseCreate, current_user=Depends(require_visibility("expenses"))):
    from datetime import datetime as _dt, timedelta as _td
    data = payload.model_dump()
    # Strip response-only / non-stored fields
    for k in ("paid_amount", "balance_due", "recurrence", "recurrence_count"):
        data.pop(k, None)
    if data.get("season_ids") is None:
        data.pop("season_ids", None)
    # Auto-populate due_date from incurred_on if not provided
    if not data.get("due_date"):
        data["due_date"] = data.get("incurred_on")

    recurrence = payload.recurrence
    count = max(1, int(payload.recurrence_count or 1)) if recurrence else 1
    group_id = str(uuid.uuid4()) if (recurrence and count > 1) else None

    created: List[ExpenseEntry] = []
    docs: List[dict] = []

    def _shift(date_str: str, n: int) -> Optional[str]:
        """Shift an ISO date string by n iterations of the recurrence."""
        if not date_str or not recurrence or n == 0:
            return date_str
        try:
            base = _dt.fromisoformat(date_str[:10]).date()
        except Exception:
            return date_str
        if recurrence == "monthly":
            # Add n months, clamping day to month length
            y, m = base.year, base.month + n
            y += (m - 1) // 12
            m = ((m - 1) % 12) + 1
            from calendar import monthrange
            d = min(base.day, monthrange(y, m)[1])
            return _dt(y, m, d).date().isoformat()
        if recurrence == "weekly":
            return (base + _td(days=7 * n)).isoformat()
        if recurrence == "biweekly":
            return (base + _td(days=14 * n)).isoformat()
        return date_str

    for i in range(count):
        entry = ExpenseEntry(
            user_id=current_user["id"],
            **{**data, "incurred_on": _shift(data["incurred_on"], i), "due_date": _shift(data.get("due_date"), i)},
            recurrence_group_id=group_id,
        )
        stored = entry.model_dump()
        stored.pop("paid_amount", None)
        stored.pop("balance_due", None)
        docs.append(stored)
        entry.balance_due = round(entry.amount - entry.paid_amount, 2)
        created.append(entry)
    if docs:
        await db.expenses.insert_many(docs)
    return created


@router.post("/expenses/bulk", response_model=List[ExpenseEntry])
async def create_expenses_bulk(payload: ExpenseBulkCreate, current_user=Depends(require_visibility("expenses"))):
    user_id = current_user["id"]
    if not payload.athlete_ids:
        raise HTTPException(status_code=400, detail="Select at least one athlete")
    if payload.amount is None or payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    # Validate athletes belong to user
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
    # Auto-populate due_date from incurred_on if not provided
    due = payload.due_date or payload.incurred_on
    created: List[ExpenseEntry] = []
    docs: List[dict] = []
    for aid in payload.athlete_ids:
        entry = ExpenseEntry(
            user_id=user_id,
            athlete_id=aid,
            category=payload.category,
            amount=per_amt,
            note=payload.note,
            incurred_on=payload.incurred_on,
            due_date=due,
            paid=payload.paid,
            season_ids=payload.season_ids or [],
        )
        stored = entry.model_dump()
        stored.pop("paid_amount", None)
        stored.pop("balance_due", None)
        docs.append(stored)
        entry.balance_due = round(entry.amount, 2)
        created.append(entry)
    if docs:
        await db.expenses.insert_many(docs)
    return created


@router.patch("/expenses/{expense_id}", response_model=ExpenseEntry)
async def update_expense(expense_id: str, payload: ExpenseUpdate, current_user=Depends(require_visibility("expenses"))):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.expenses.update_one(
        {"id": expense_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    doc = await db.expenses.find_one({"id": expense_id}, {"_id": 0})
    paid_map = await _build_paid_map(current_user["id"])
    return _expense_with_balance(doc, paid_map)


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current_user=Depends(require_visibility("expenses"))):
    res = await db.expenses.delete_one({
        "id": expense_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}
    })
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"deleted": True}


@router.post("/expenses/{expense_id}/apply-payment", response_model=ExpenseEntry)
async def apply_payment_to_expense(
    expense_id: str,
    payload: ApplyPaymentRequest,
    current_user=Depends(require_visibility("expenses")),
):
    user_id = current_user["id"]
    if payload.amount is None or payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    expense = await db.expenses.find_one({"id": expense_id, "user_id": user_id}, {"_id": 0})
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # Determine remaining balance for this expense
    paid_map = await _build_paid_map(user_id)
    current_paid = float(paid_map.get(expense_id, 0.0))
    remaining = max(0.0, float(expense.get("amount") or 0.0) - current_paid)
    if remaining <= 0 or expense.get("paid"):
        raise HTTPException(status_code=400, detail="Expense is already fully paid")

    apply_amt = round(min(payload.amount, remaining), 2)

    # Handle fundraiser source
    fundraiser_doc = None
    if payload.source_type == "fundraiser":
        if not payload.fundraiser_id:
            raise HTTPException(status_code=400, detail="fundraiser_id required for fundraiser source")
        fundraiser_doc = await db.fundraisers.find_one(
            {"id": payload.fundraiser_id, "user_id": user_id}, {"_id": 0}
        )
        if not fundraiser_doc:
            raise HTTPException(status_code=404, detail="Fundraiser not found")
        fund_raised = float(fundraiser_doc.get("amount_raised") or 0.0)
        fund_applied = float(fundraiser_doc.get("applied_amount") or 0.0)
        fund_available = round(fund_raised - fund_applied, 2)
        if fund_available <= 0:
            raise HTTPException(status_code=400, detail="Fundraiser has no available balance")
        # cap apply_amt to the smaller of remaining and fundraiser available
        apply_amt = round(min(apply_amt, fund_available), 2)
        await db.fundraisers.update_one(
            {"id": payload.fundraiser_id, "user_id": user_id},
            {"$inc": {"applied_amount": apply_amt}},
        )

    method = payload.method or ("Fundraiser" if payload.source_type == "fundraiser" else None)
    note_parts: List[str] = []
    if fundraiser_doc:
        note_parts.append(f"From fundraiser: {fundraiser_doc.get('name', '')}")
    if payload.note:
        note_parts.append(payload.note)
    note = " — ".join([p for p in note_parts if p]) or None

    payment = PaymentEntry(
        user_id=user_id,
        athlete_id=expense["athlete_id"],
        amount=apply_amt,
        paid_on=payload.paid_on or date.today().isoformat(),
        method=method,
        note=note,
        applied_expense_ids=[expense_id],
        allocations=[PaymentAllocation(expense_id=expense_id, amount=apply_amt)],
    )
    await db.payments.insert_one(payment.model_dump())

    # If fully covered, flip expense.paid
    new_paid_total = round(current_paid + apply_amt, 2)
    fully_paid = new_paid_total >= float(expense.get("amount") or 0.0) - 1e-6
    if fully_paid and not expense.get("paid"):
        await db.expenses.update_one(
            {"id": expense_id, "user_id": user_id}, {"$set": {"paid": True}}
        )
        expense["paid"] = True

    paid_map = await _build_paid_map(user_id)
    return _expense_with_balance(expense, paid_map)


@router.post("/expenses/{expense_id}/apply-available-payments")
async def apply_available_payments(expense_id: str, current_user=Depends(require_visibility("expenses"))):
    """Pull leftover funds from this athlete's existing payments and apply
    them to the given expense.
    """
    member_ids = await _household_user_ids(current_user["id"])
    exp = await db.expenses.find_one(
        {"id": expense_id, "user_id": {"$in": member_ids}}, {"_id": 0},
    )
    if not exp:
        raise HTTPException(status_code=404, detail="Expense not found")

    amt = float(exp.get("amount") or 0)
    if exp.get("paid"):
        return {"applied": 0.0, "balance_due": 0.0, "payments_touched": 0}

    paid_map = await _build_paid_map(current_user["id"])
    balance_due = round(max(0.0, amt - float(paid_map.get(expense_id, 0.0))), 2)
    if balance_due <= 0:
        return {"applied": 0.0, "balance_due": 0.0, "payments_touched": 0}

    athlete_id = exp.get("athlete_id")
    if not athlete_id:
        raise HTTPException(status_code=400, detail="Expense has no athlete")

    remaining = balance_due
    applied_total = 0.0
    touched = 0
    async for p in db.payments.find(
        {"user_id": {"$in": member_ids}, "athlete_id": athlete_id},
        {"_id": 0},
    ).sort([("paid_on", 1), ("created_at", 1)]):
        if remaining <= 0:
            break
        p_amt = float(p.get("amount") or 0)
        allocations = list(p.get("allocations") or [])
        if allocations:
            used = sum(float(a.get("amount") or 0) for a in allocations)
        elif p.get("applied_expense_ids"):
            # Legacy / single-POST payment: treat fully allocated to avoid double-spend.
            used = p_amt
        else:
            used = 0.0
        free = round(p_amt - used, 2)
        if free <= 0:
            continue
        already_for_this_exp = sum(
            float(a.get("amount") or 0) for a in allocations
            if a.get("expense_id") == expense_id
        )
        if already_for_this_exp >= amt - 1e-6:
            continue
        take = round(min(free, remaining), 2)
        if take <= 0:
            continue
        allocations.append({"expense_id": expense_id, "amount": take})
        applied_ids = list(set((p.get("applied_expense_ids") or []) + [expense_id]))
        await db.payments.update_one(
            {"id": p["id"]},
            {"$set": {"allocations": allocations, "applied_expense_ids": applied_ids}},
        )
        applied_total = round(applied_total + take, 2)
        remaining = round(remaining - take, 2)
        touched += 1

    new_paid_total = round(float(paid_map.get(expense_id, 0.0)) + applied_total, 2)
    if new_paid_total + 1e-6 >= amt and not exp.get("paid"):
        await db.expenses.update_one(
            {"id": expense_id, "user_id": {"$in": member_ids}}, {"$set": {"paid": True}},
        )

    return {
        "applied": applied_total,
        "balance_due": max(0.0, round(amt - new_paid_total, 2)),
        "payments_touched": touched,
    }
