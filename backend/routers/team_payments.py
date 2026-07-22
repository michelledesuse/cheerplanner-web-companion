from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    PaymentTracker,
    PaymentTrackerCreate,
    PaymentTrackerUpdate,
    PaymentEntryUpdate,
    PaymentExcludeUpdate,
    utcnow_iso,
)
from core.security import get_current_user, require_team_access
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api/team", dependencies=[Depends(require_team_access)])


def _summary(tracker: dict, roster_total: int, excluded_in_roster: int = 0) -> dict:
    excluded = set(tracker.get("excluded_member_ids") or [])
    entries = [e for e in (tracker.get("entries") or []) if e.get("member_id") not in excluded]
    # Effective number of people required to pay (roster minus exempt).
    member_total = max(0, roster_total - excluded_in_roster)
    paid_entries = [e for e in entries if e.get("paid")]
    expected = tracker.get("amount")
    collected = 0.0
    for e in paid_entries:
        amt = e.get("amount_paid")
        if amt is None:
            amt = expected or 0
        collected += float(amt or 0)

    unpaid_count = max(0, member_total - len(paid_entries))
    summary = {
        "paid_count": len(paid_entries),
        "member_total": member_total,
        "excluded_count": excluded_in_roster,
        "collected": round(collected, 2),
        "expected_per_person": expected,
        "unpaid_count": unpaid_count,
    }

    if expected is not None:
        exp = float(expected or 0)
        # Per-person shortfall: recorded people who paid less than expected,
        # plus everyone not yet recorded (they owe the full expected amount).
        covered = 0
        entry_shortfall = 0.0
        for e in paid_entries:
            amt = e.get("amount_paid")
            paid_amt = float(amt if amt is not None else exp)
            if paid_amt >= exp:
                covered += 1
            else:
                entry_shortfall += (exp - paid_amt)
        outstanding = entry_shortfall + exp * unpaid_count
        summary["short_count"] = max(0, member_total - covered)
        summary["outstanding"] = round(outstanding, 2)
        summary["expected_total"] = round(exp * member_total, 2)
    else:
        # No expected amount set — "owing" just means not yet marked paid.
        summary["short_count"] = unpaid_count
        summary["outstanding"] = None
        summary["expected_total"] = None

    return summary


async def _roster_total(member_ids: List[str]) -> int:
    return await db.roster.count_documents({"user_id": {"$in": member_ids}, "role": {"$ne": "parent"}})


async def _excluded_in_roster(member_ids: List[str], excluded_ids: List[str]) -> int:
    """How many of the exempt ids are still real (non-parent) roster members."""
    if not excluded_ids:
        return 0
    return await db.roster.count_documents(
        {"user_id": {"$in": member_ids}, "role": {"$ne": "parent"}, "id": {"$in": excluded_ids}}
    )


@router.get("/payments")
async def list_payment_trackers(current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.payment_trackers.find({"user_id": {"$in": member_ids}}, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    roster_total = await _roster_total(member_ids)
    out = []
    for d in docs:
        exc = await _excluded_in_roster(member_ids, d.get("excluded_member_ids") or [])
        out.append({**PaymentTracker(**d).model_dump(), "summary": _summary(d, roster_total, exc)})
    return out


@router.post("/payments", response_model=PaymentTracker)
async def create_payment_tracker(payload: PaymentTrackerCreate, current_user=Depends(get_current_user)):
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="Name is required")
    tracker = PaymentTracker(user_id=current_user["id"], **payload.model_dump(exclude_none=True))
    tracker.name = payload.name.strip()
    await db.payment_trackers.insert_one(tracker.model_dump())
    return tracker


@router.get("/payments/{tracker_id}")
async def get_payment_tracker(tracker_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.payment_trackers.find_one({"id": tracker_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tracker not found")
    roster_total = await _roster_total(member_ids)
    exc = await _excluded_in_roster(member_ids, doc.get("excluded_member_ids") or [])
    return {**PaymentTracker(**doc).model_dump(), "summary": _summary(doc, roster_total, exc)}


@router.patch("/payments/{tracker_id}", response_model=PaymentTracker)
async def update_payment_tracker(tracker_id: str, payload: PaymentTrackerUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "name" in updates and not (updates["name"] or "").strip():
        raise HTTPException(status_code=400, detail="Name cannot be blank")
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.payment_trackers.update_one(
        {"id": tracker_id, "user_id": {"$in": member_ids}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tracker not found")
    doc = await db.payment_trackers.find_one({"id": tracker_id}, {"_id": 0})
    return PaymentTracker(**doc)


@router.delete("/payments/{tracker_id}")
async def delete_payment_tracker(tracker_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.payment_trackers.delete_one({"id": tracker_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tracker not found")
    return {"deleted": True}


@router.put("/payments/{tracker_id}/member/{member_id}")
async def set_member_status(tracker_id: str, member_id: str, payload: PaymentEntryUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.payment_trackers.find_one({"id": tracker_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tracker not found")
    # ensure member belongs to the household roster
    rm = await db.roster.find_one({"id": member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
    if not rm:
        raise HTTPException(status_code=404, detail="Roster member not found")

    entries = doc.get("entries") or []
    entry = next((e for e in entries if e.get("member_id") == member_id), None)
    if entry is None:
        entry = {"member_id": member_id, "paid": False, "amount_paid": None, "method": None, "note": None, "paid_at": None}
        entries.append(entry)

    data = payload.model_dump(exclude_unset=True)
    if "paid" in data:
        entry["paid"] = bool(data["paid"])
        # Default the paid date to now when marking paid; clear it when unpaid.
        entry["paid_at"] = utcnow_iso() if data["paid"] else None
        if not data["paid"]:
            entry["method"] = None
    if "paid_at" in data and data["paid_at"] is not None:
        entry["paid_at"] = data["paid_at"]
    if "amount_paid" in data:
        entry["amount_paid"] = data["amount_paid"]
    if "method" in data:
        entry["method"] = data["method"]
    if "note" in data:
        entry["note"] = data["note"]

    await db.payment_trackers.update_one({"id": tracker_id}, {"$set": {"entries": entries}})
    updated = await db.payment_trackers.find_one({"id": tracker_id}, {"_id": 0})
    roster_total = await _roster_total(member_ids)
    exc = await _excluded_in_roster(member_ids, updated.get("excluded_member_ids") or [])
    return {**PaymentTracker(**updated).model_dump(), "summary": _summary(updated, roster_total, exc)}


@router.put("/payments/{tracker_id}/member/{member_id}/exclude")
async def set_member_excluded(tracker_id: str, member_id: str, payload: PaymentExcludeUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.payment_trackers.find_one({"id": tracker_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tracker not found")
    rm = await db.roster.find_one({"id": member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
    if not rm:
        raise HTTPException(status_code=404, detail="Roster member not found")
    excluded = set(doc.get("excluded_member_ids") or [])
    if payload.excluded:
        excluded.add(member_id)
    else:
        excluded.discard(member_id)
    await db.payment_trackers.update_one({"id": tracker_id}, {"$set": {"excluded_member_ids": list(excluded)}})
    updated = await db.payment_trackers.find_one({"id": tracker_id}, {"_id": 0})
    roster_total = await _roster_total(member_ids)
    exc = await _excluded_in_roster(member_ids, updated.get("excluded_member_ids") or [])
    return {**PaymentTracker(**updated).model_dump(), "summary": _summary(updated, roster_total, exc)}
