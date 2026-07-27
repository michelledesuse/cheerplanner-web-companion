from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    PaymentTracker,
    PaymentTrackerCreate,
    PaymentTrackerUpdate,
    PaymentEntryUpdate,
    PaymentExcludeUpdate,
    TeamPaymentEntry,
    utcnow_iso,
)
from core.security import get_current_user, require_team_access
from core.helpers import _household_user_ids, _blocked_resource_ids
from core.sms import send_sms, is_configured, normalize_us_phone

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
            amt = e.get("amount_due") if e.get("amount_due") is not None else (expected or 0)
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

    if expected is not None or any(e.get("amount_due") is not None for e in entries):
        exp = float(expected or 0)
        # Per-person shortfall using each member's own amount due when set — for
        # BOTH paid and unpaid entries, plus the tracker default for anyone with
        # no entry yet.
        covered = 0
        outstanding = 0.0
        expected_total = 0.0
        unpaid_entries = [e for e in entries if not e.get("paid")]
        for e in paid_entries:
            due = e.get("amount_due")
            due = float(due) if due is not None else exp
            amt = e.get("amount_paid")
            paid_amt = float(amt if amt is not None else due)
            expected_total += due
            if due <= 0 or paid_amt >= due:
                covered += 1
            else:
                outstanding += (due - paid_amt)
        for e in unpaid_entries:
            due = e.get("amount_due")
            due = float(due) if due is not None else exp
            expected_total += due
            outstanding += max(0.0, due)
        no_entry_count = max(0, member_total - len(entries))
        outstanding += exp * no_entry_count
        expected_total += exp * no_entry_count
        summary["short_count"] = max(0, member_total - covered)
        summary["outstanding"] = round(outstanding, 2)
        summary["expected_total"] = round(expected_total, 2)
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
async def list_payment_trackers(event_id: str | None = None, competition_id: str | None = None, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    query: dict = {"user_id": {"$in": member_ids}}
    if event_id:
        query["event_ids"] = event_id
    if competition_id:
        query["competition_ids"] = competition_id
    docs = await db.payment_trackers.find(query, {"_id": 0}).to_list(1000)
    blocked = await _blocked_resource_ids(current_user["id"], "payment")
    docs = [d for d in docs if d["id"] not in blocked]
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


@router.post("/payments/{tracker_id}/remind")
async def remind_owing(tracker_id: str, current_user=Depends(get_current_user)):
    """Text each person who still owes an INDIVIDUAL reminder via Twilio."""
    if not is_configured():
        raise HTTPException(status_code=400, detail="SMS isn't configured. Add your Twilio number in settings.")
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.payment_trackers.find_one({"id": tracker_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tracker not found")

    excluded = set(doc.get("excluded_member_ids") or [])
    expected = doc.get("amount")
    entries = {e.get("member_id"): e for e in (doc.get("entries") or [])}
    tracker_name = doc.get("name") or "team payment"

    roster = await db.roster.find(
        {"user_id": {"$in": member_ids}, "role": {"$ne": "parent"}}, {"_id": 0}
    ).to_list(2000)

    sent, no_phone, failed = 0, [], []
    for m in roster:
        if m["id"] in excluded:
            continue
        e = entries.get(m["id"])
        paid = bool(e and e.get("paid"))
        member_due = None
        if e and e.get("amount_due") is not None:
            member_due = float(e["amount_due"])
        elif expected is not None:
            member_due = float(expected)
        paid_amt = 0.0
        if paid:
            amt = e.get("amount_paid")
            paid_amt = float(amt if amt is not None else (member_due or 0))
        owed = None
        if member_due is not None:
            owed = max(0.0, member_due - paid_amt)
            if owed <= 0:
                continue  # fully covered
        else:
            if paid:
                continue  # marked paid

        # Athlete -> use parent phone; personnel -> own phone.
        phone = (m.get("parent_phone") or m.get("phone")) if m.get("role") == "athlete" else (m.get("phone") or m.get("parent_phone"))
        if not normalize_us_phone(phone):
            no_phone.append(m.get("name"))
            continue

        first = (m.get("first_name") or (m.get("name") or "").split(" ")[0] or "there")
        amount_txt = f" of ${owed:,.2f}" if owed and owed > 0 else ""
        body = f"Hi {first}, friendly reminder about '{tracker_name}': a balance{amount_txt} is still outstanding. Thank you!"
        if send_sms(phone, body):
            sent += 1
        else:
            failed.append(m.get("name"))

    return {"sent": sent, "no_phone": no_phone, "failed": failed}


@router.get("/payments/{tracker_id}")
async def get_payment_tracker(tracker_id: str, current_user=Depends(get_current_user)):
    if tracker_id in await _blocked_resource_ids(current_user["id"], "payment"):
        raise HTTPException(status_code=403, detail="You don't have access to this tracker")
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


@router.post("/payments/{tracker_id}/duplicate")
async def duplicate_payment_tracker(tracker_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.payment_trackers.find_one({"id": tracker_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tracker not found")
    # Fresh tracker: keep name/amount/exemptions & per-member amounts due, clear who's paid.
    copy = PaymentTracker(
        user_id=current_user["id"],
        name=f"{doc.get('name')} (copy)",
        amount=doc.get("amount"),
        note=doc.get("note"),
        excluded_member_ids=list(doc.get("excluded_member_ids") or []),
        entries=[TeamPaymentEntry(member_id=e["member_id"], amount_due=e.get("amount_due")).model_dump()
                 for e in (doc.get("entries") or []) if e.get("amount_due") is not None],
    )
    await db.payment_trackers.insert_one(copy.model_dump())
    roster_total = await _roster_total(member_ids)
    exc = await _excluded_in_roster(member_ids, copy.excluded_member_ids)
    return {**copy.model_dump(), "summary": _summary(copy.model_dump(), roster_total, exc)}


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
    if "amount_due" in data:
        entry["amount_due"] = data["amount_due"]
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
