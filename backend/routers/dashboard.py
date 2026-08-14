from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from core.db import db
from core.security import get_current_user
from core.helpers import _build_paid_map, parse_date, _member_visibility

router = APIRouter(prefix="/api")


@router.get("/dashboard")
async def dashboard(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    today = datetime.now(timezone.utc).date()
    vis = await _member_visibility(user_id)
    can_expenses = vis.get("expenses", True)
    can_travel = vis.get("travel", True)

    athletes_count = await db.athletes.count_documents({"user_id": user_id})
    comps_count = await db.competitions.count_documents({"user_id": user_id})

    # Total expenses & payments YTD
    total_expenses = 0.0
    async for d in db.expenses.find({"user_id": user_id}, {"_id": 0, "amount": 1}).limit(20000):
        total_expenses += float(d.get("amount") or 0)

    today_iso = today.isoformat()
    due_today_bookings = 0.0
    due_today_expenses = 0.0

    # Booking balances
    booking_balance = 0.0
    async for d in db.bookings.find({"user_id": user_id}, {"_id": 0, "cost": 1, "amount_paid": 1, "balance_due_date": 1}).limit(5000):
        bal = float(d.get("cost") or 0) - float(d.get("amount_paid") or 0)
        booking_balance += bal
        _bdd = str(d.get("balance_due_date") or "")[:10]
        if bal > 0 and _bdd and _bdd <= today_iso:
            due_today_bookings += bal

    # Unpaid expense balance + total paid YTD — derived from canonical paid_map.
    paid_map = await _build_paid_map(user_id)
    unpaid_expense_balance = 0.0
    paid_from_expenses = 0.0
    async for d in db.expenses.find(
        {"user_id": user_id}, {"_id": 0, "id": 1, "amount": 1, "paid": 1, "due_date": 1}
    ).limit(20000):
        amt = float(d.get("amount") or 0)
        paid = float(paid_map.get(d.get("id"), 0.0))
        # Backend invariant: paid_amount equals amount whenever paid=true.
        if d.get("paid") and paid < amt:
            paid = amt
        paid_from_expenses += min(paid, amt)
        bal = max(0.0, amt - paid)
        unpaid_expense_balance += bal
        _dd = str(d.get("due_date") or "")[:10]
        if bal > 0 and _dd and _dd <= today_iso:
            due_today_expenses += bal

    # Next competition
    next_comp = None
    async for d in db.competitions.find({"user_id": user_id}, {"_id": 0}).sort("event_date", 1):
        ed = parse_date(d.get("event_date"))
        if ed and ed >= today:
            next_comp = d
            break

    # Fundraisers total
    total_raised = 0.0
    async for d in db.fundraisers.find({"user_id": user_id}, {"_id": 0, "amount_raised": 1}).limit(5000):
        total_raised += float(d.get("amount_raised") or 0)

    # This month spend (DB-level prefix match on incurred_on YYYY-MM)
    this_month = today.strftime("%Y-%m")
    month_spend = 0.0
    async for d in db.expenses.find(
        {"user_id": user_id, "incurred_on": {"$regex": f"^{this_month}"}},
        {"_id": 0, "amount": 1},
    ).limit(20000):
        month_spend += float(d.get("amount") or 0)

    # Suggest creating a season only once there's data worth filtering by year:
    # zero seasons AND competition dates span > 12 months.
    suggest_season = False
    seasons_count = await db.seasons.count_documents({"user_id": user_id})
    if seasons_count == 0:
        dates = [c.get("event_date") async for c in db.competitions.find(
            {"user_id": user_id}, {"_id": 0, "event_date": 1}).limit(20000)]
        dates = sorted(d[:10] for d in dates if d)
        if len(dates) >= 2:
            try:
                span = (datetime.fromisoformat(dates[-1]).date() - datetime.fromisoformat(dates[0]).date()).days
                suggest_season = span > 365
            except Exception:
                suggest_season = False

    return {
        "athletes_count": athletes_count,
        "competitions_count": comps_count,
        "total_expenses_ytd": round(total_expenses, 2) if can_expenses else 0.0,
        "total_payments_ytd": round(paid_from_expenses, 2) if can_expenses else 0.0,
        "outstanding_balance": round(
            (unpaid_expense_balance if can_expenses else 0.0)
            + (booking_balance if can_travel else 0.0), 2),
        "due_today": round((due_today_expenses if can_expenses else 0.0)
                           + (due_today_bookings if can_travel else 0.0), 2),
        "booking_balance": round(booking_balance, 2) if can_travel else 0.0,
        "unpaid_expense_balance": round(unpaid_expense_balance, 2) if can_expenses else 0.0,
        "month_spend": round(month_spend, 2) if can_expenses else 0.0,
        "total_raised": round(total_raised, 2),
        "next_competition": next_comp,
        "can_view_expenses": can_expenses,
        "can_view_travel": can_travel,
        "suggest_season": suggest_season,
    }
