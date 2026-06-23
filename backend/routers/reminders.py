from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from core.db import db
from core.security import get_current_user
from core.helpers import _household_user_ids, parse_date

router = APIRouter(prefix="/api")


@router.get("/reminders")
async def reminders(current_user=Depends(get_current_user)):
    """Returns a list of upcoming due items: expense due_date, booking balance_due_date,
    competition booking_release_at, and competition event_date. Each item has urgency level."""
    today = datetime.now(timezone.utc).date()
    items = []

    member_ids = await _household_user_ids(current_user["id"])

    # Unpaid expenses with due date
    async for d in db.expenses.find(
        {"user_id": {"$in": member_ids}, "due_date": {"$ne": None}, "paid": False}, {"_id": 0}
    ):
        due = parse_date(d.get("due_date"))
        if not due:
            continue
        delta = (due - today).days
        items.append({
            "id": f"expense:{d['id']}",
            "kind": "expense",
            "title": f"{d.get('category')} payment",
            "subtitle": d.get("note") or "",
            "amount": d.get("amount"),
            "due_date": d.get("due_date"),
            "days_until": delta,
            "ref_id": d["id"],
            "athlete_id": d.get("athlete_id"),
        })

    # Bookings with balance_due_date and balance > 0
    async for d in db.bookings.find(
        {"user_id": {"$in": member_ids}, "balance_due_date": {"$ne": None}}, {"_id": 0}
    ):
        due = parse_date(d.get("balance_due_date"))
        if not due:
            continue
        balance = float(d.get("cost") or 0) - float(d.get("amount_paid") or 0)
        if balance <= 0:
            continue
        delta = (due - today).days
        items.append({
            "id": f"booking:{d['id']}",
            "kind": "booking",
            "title": f"{d.get('type','').title()} balance: {d.get('provider') or ''}",
            "subtitle": d.get("notes") or "",
            "amount": balance,
            "due_date": d.get("balance_due_date"),
            "days_until": delta,
            "ref_id": d["id"],
            "competition_id": d.get("competition_id"),
        })

    # Booking release datetimes for competitions
    async for d in db.competitions.find(
        {"user_id": {"$in": member_ids}, "booking_release_at": {"$ne": None}}, {"_id": 0}
    ):
        rel = parse_date(d.get("booking_release_at"))
        if not rel:
            continue
        delta = (rel - today).days
        if delta < -1:
            continue
        items.append({
            "id": f"release:{d['id']}",
            "kind": "booking_release",
            "title": f"Booking opens: {d.get('name')}",
            "subtitle": d.get("location") or "",
            "amount": None,
            "due_date": d.get("booking_release_at"),
            "days_until": delta,
            "ref_id": d["id"],
        })

    # Cancel-by dates for hotels
    async for d in db.bookings.find(
        {"user_id": {"$in": member_ids}, "cancel_by": {"$ne": None}, "type": "hotel"}, {"_id": 0}
    ):
        cb = parse_date(d.get("cancel_by"))
        if not cb:
            continue
        delta = (cb - today).days
        if delta < -1 or delta > 30:
            continue
        items.append({
            "id": f"cancel:{d['id']}",
            "kind": "cancel_by",
            "title": f"Cancel deadline: {d.get('provider') or 'Hotel'}",
            "subtitle": "Free cancel by",
            "amount": None,
            "due_date": d.get("cancel_by"),
            "days_until": delta,
            "ref_id": d["id"],
            "competition_id": d.get("competition_id"),
        })

    # Pack-for-comp reminders — fires within the next 7 days when the comp's
    # packing list has unchecked items (or doesn't exist yet).
    async for c in db.competitions.find(
        {"user_id": {"$in": member_ids}}, {"_id": 0},
    ):
        ev = parse_date(c.get("event_date"))
        if not ev:
            continue
        delta = (ev - today).days
        if delta < 0 or delta > 7:
            continue
        pl = await db.packing_lists.find_one(
            {"competition_id": c["id"], "user_id": {"$in": member_ids}}, {"_id": 0},
        )
        unchecked = 0
        total = 0
        if pl:
            for it in (pl.get("items") or []):
                cb = it.get("checked_by") or {}
                keys = list(cb.keys()) or ["shared"]
                for k in keys:
                    total += 1
                    if not cb.get(k):
                        unchecked += 1
        else:
            unchecked = 1  # nudge to create one
            total = 0
        if unchecked <= 0:
            continue
        items.append({
            "id": f"packing:{c['id']}",
            "kind": "packing",
            "title": f"Pack for {c.get('name', 'competition')}",
            "subtitle": (
                f"{unchecked} items left" if total > 0 else "Tap to create a packing list"
            ),
            "amount": None,
            "due_date": c.get("event_date"),
            "days_until": delta,
            "ref_id": c["id"],
            "competition_id": c["id"],
        })

    items.sort(key=lambda x: (x["days_until"] if x["days_until"] is not None else 9999))
    return {"items": items, "today": today.isoformat()}
