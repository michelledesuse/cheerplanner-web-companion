"""Shared helpers used by multiple routers.

Includes household scoping, paid-map computation, waterfall allocation,
recurrence expansion, time formatting, and small data shapers.
"""
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Dict, Any

from core.db import db
from core.models import (
    Household, PaymentAllocation, ExpenseEntry, Fundraiser,
    PackingItem, PackingChecklistItem, RecurrenceRule,
)


# ============================================================
# Household scoping
# ============================================================
async def _get_or_create_household(user_id: str) -> dict:
    """Return the household this user belongs to. Lazy-creates a solo household for legacy users."""
    h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    if h:
        return h
    new_h = Household(member_user_ids=[user_id]).model_dump()
    await db.households.insert_one(dict(new_h))
    return new_h


async def _household_user_ids(user_id: str) -> List[str]:
    """Return all user_ids in the same household as the requester (including the requester)."""
    h = await _get_or_create_household(user_id)
    return h.get("member_user_ids", [user_id])


# ============================================================
# Time / date helpers
# ============================================================
def parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        # try date or datetime
        if "T" in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        return date.fromisoformat(s[:10])
    except Exception:
        return None


def parse_local_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse a freeform date/datetime string into a NAIVE local datetime.

    Accepts ISO ('2026-07-08T14:30', '2026-07-08 14:30', '2026-07-08'),
    or freeform 'DD-MM-YYYY HH:MM' / 'DD/MM/YYYY HH:MM' (as flight times are
    stored). Time defaults to 00:00 when absent. Any tz info is dropped so the
    scheduler can compare against the user's local wall-clock time. Returns
    None if the date part is unparseable.
    """
    if not value:
        return None
    v = str(value).strip()
    if not v:
        return None
    # Extract HH:MM (24h) if present.
    hh, mm = 0, 0
    import re as _re
    tm = _re.search(r"(\d{1,2}):(\d{2})", v)
    if tm:
        h_, m_ = int(tm.group(1)), int(tm.group(2))
        if 0 <= h_ <= 23 and 0 <= m_ <= 59:
            hh, mm = h_, m_
    # Normalize the date part to a `date`.
    d: Optional[date] = None
    first10 = v[:10]
    if len(first10) == 10 and first10[4] == "-" and first10[7] == "-":
        try:
            d = date.fromisoformat(first10)
        except Exception:
            d = None
    if d is None:
        head = v.split(" ")[0].split("T")[0].replace("/", "-")
        parts = head.split("-")
        if len(parts) == 3:
            a, b, c = parts
            try:
                if len(c) == 4 and len(a) <= 2 and len(b) <= 2:  # DD-MM-YYYY
                    d = date(int(c), int(b), int(a))
                elif len(a) == 4:  # YYYY-MM-DD
                    d = date(int(a), int(b), int(c))
            except Exception:
                d = None
    if d is None:
        return None
    return datetime(d.year, d.month, d.day, hh, mm)


def _fmt_time_12h(value: Optional[str]) -> str:
    """Convert 24h 'HH:MM' (or a free-form datetime string containing HH:MM) to 12h 'h:MM AM/PM'."""
    if not value:
        return ""
    import re as _re
    m = _re.search(r"(\d{1,2}):(\d{2})", str(value))
    if not m:
        return str(value)
    h = int(m.group(1))
    mm = m.group(2)
    period = "PM" if h >= 12 else "AM"
    h12 = h % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{mm} {period}"


def _extract_hhmm(value: Optional[str]) -> Optional[str]:
    """Pull 'HH:MM' (24h) from any string that contains it (e.g. '2025-11-13 08:30')."""
    if not value:
        return None
    import re as _re
    m = _re.search(r"(\d{1,2}):(\d{2})", str(value))
    if not m:
        return None
    try:
        h = int(m.group(1))
        if not (0 <= h <= 23):
            return None
    except ValueError:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def _expand_recurrence(base_date: str, rule: RecurrenceRule) -> List[str]:
    """Return a sorted, deduped list of ISO YYYY-MM-DD dates for a recurring series.

    Always includes base_date as the first occurrence. `until` is inclusive.
    """
    try:
        start = datetime.strptime(base_date, "%Y-%m-%d").date()
    except Exception:
        return [base_date]
    try:
        end = datetime.strptime(rule.until, "%Y-%m-%d").date()
    except Exception:
        return [base_date]
    if end < start:
        return [base_date]

    freq = (rule.frequency or "weekly").lower()
    dates: List[date] = []
    # Safety cap so a misconfigured rule cannot blow up the DB.
    MAX_OCC = 366

    if freq == "daily":
        cur = start
        while cur <= end and len(dates) < MAX_OCC:
            dates.append(cur)
            cur = cur + timedelta(days=1)

    elif freq in ("weekly", "biweekly"):
        # Python weekday: Mon=0..Sun=6 ; rule uses Sun=0..Sat=6 → convert.
        def _py_dow(rule_dow: int) -> int:
            return (rule_dow - 1) % 7  # Sun=0 → 6, Mon=1 → 0, …
        wanted = sorted({_py_dow(d) for d in (rule.days_of_week or [])}) or [start.weekday()]
        step_weeks = 2 if freq == "biweekly" else 1
        # Walk week by week from the week containing start (Monday-based).
        week_anchor = start - timedelta(days=start.weekday())
        while week_anchor <= end and len(dates) < MAX_OCC:
            for dow in wanted:
                d = week_anchor + timedelta(days=dow)
                if d < start or d > end:
                    continue
                dates.append(d)
            week_anchor = week_anchor + timedelta(weeks=step_weeks)

    elif freq == "monthly":
        # Same day-of-month each month.
        y, m, d_ = start.year, start.month, start.day
        while True:
            try:
                cur = date(y, m, d_)
            except ValueError:
                # Skip months that don't have this day (e.g., Feb 30).
                pass
            else:
                if cur > end:
                    break
                if cur >= start:
                    dates.append(cur)
            # next month
            m += 1
            if m > 12:
                m = 1
                y += 1
            if len(dates) >= MAX_OCC:
                break
    else:
        return [base_date]

    iso_set = sorted({d.isoformat() for d in dates})
    return iso_set or [base_date]


def _date_range(start_date: str, end_date: str) -> List[str]:
    """Return inclusive list of ISO YYYY-MM-DD dates from start to end.

    Used to split a multi-day event into one editable event per day. Falls back
    to [start_date] on bad input; capped at 366 days for safety.
    """
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
    except Exception:
        return [start_date]
    if end < start:
        return [start_date]
    out: List[str] = []
    cur = start
    while cur <= end and len(out) < 366:
        out.append(cur.isoformat())
        cur = cur + timedelta(days=1)
    return out



# ============================================================
# Financial helpers (expenses / payments)
# ============================================================
async def _waterfall_allocations(
    user_id: str,
    payment_amount: float,
    expense_ids: List[str],
    ignore_payment_id: Optional[str] = None,
) -> List[PaymentAllocation]:
    """Build per-expense allocations that pay each selected expense IN FULL,
    in due-date order (oldest first), until the payment amount is exhausted.

    `ignore_payment_id` is used during update_payment so we don't count the
    payment being edited against its own remaining balance.
    """
    if not expense_ids or payment_amount <= 0:
        return []

    # Fetch the chosen expenses once.
    docs = await db.expenses.find(
        {"id": {"$in": expense_ids}, "user_id": user_id},
        {"_id": 0, "id": 1, "amount": 1, "due_date": 1, "incurred_on": 1},
    ).to_list(2000)

    # How much each is already paid by OTHER payments (so we only fill the gap).
    paid_so_far: dict = {eid: 0.0 for eid in expense_ids}
    async for p in db.payments.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "amount": 1, "applied_expense_ids": 1, "allocations": 1, "paid_on": 1},
    ).limit(20000):
        if ignore_payment_id and p.get("id") == ignore_payment_id:
            continue
        allocs = p.get("allocations") or []
        if allocs:
            for a in allocs:
                eid = a.get("expense_id")
                if eid in paid_so_far:
                    paid_so_far[eid] += float(a.get("amount") or 0)
            continue
        # Legacy payments without allocations: skip — they're approximated
        # elsewhere by _build_paid_map. We just want to avoid over-allocating
        # funds we don't have.

    def _due_key(eid: str):
        e = next((x for x in docs if x["id"] == eid), None) or {}
        return (e.get("due_date") or e.get("incurred_on") or "9999-12-31", eid)

    ordered = sorted(expense_ids, key=_due_key)
    remaining = round(float(payment_amount), 2)
    out: List[PaymentAllocation] = []
    for eid in ordered:
        if remaining <= 0.001:
            break
        e = next((x for x in docs if x["id"] == eid), None)
        if not e:
            continue
        owed = max(0.0, round(float(e.get("amount") or 0.0) - paid_so_far.get(eid, 0.0), 2))
        if owed <= 0.001:
            continue
        apply_amt = round(min(owed, remaining), 2)
        out.append(PaymentAllocation(expense_id=eid, amount=apply_amt))
        remaining = round(remaining - apply_amt, 2)
    return out


async def _build_paid_map(user_id: str) -> dict:
    """Return {expense_id: paid_amount_sum} from all payments for this user.

    Order of precedence per payment:
      1. `allocations` (explicit per-expense breakdown) — always wins.
      2. `applied_expense_ids` without allocations — waterfall-allocate the
         payment amount in expense due-date order (oldest first), paying each
         expense IN FULL before moving on.
    """
    paid_map: dict = {}

    # Pre-fetch expense balances we'll need for the waterfall fallback.
    expense_index: dict = {}
    async for e in db.expenses.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "amount": 1, "due_date": 1, "incurred_on": 1},
    ).limit(20000):
        expense_index[e["id"]] = e

    # Two passes:
    #   Pass 1: apply explicit `allocations` first.
    #   Pass 2: legacy payments (applied_expense_ids only) → waterfall.
    legacy_payments: list = []
    async for p in db.payments.find(
        {"user_id": user_id},
        {"_id": 0, "amount": 1, "applied_expense_ids": 1, "allocations": 1, "paid_on": 1},
    ).limit(20000):
        allocs = p.get("allocations") or []
        if allocs:
            for a in allocs:
                eid = a.get("expense_id")
                amt = float(a.get("amount") or 0)
                if eid and amt:
                    paid_map[eid] = round(paid_map.get(eid, 0.0) + amt, 2)
            continue
        if p.get("applied_expense_ids"):
            legacy_payments.append(p)

    legacy_payments.sort(key=lambda p: p.get("paid_on") or "")

    def _due_key(eid: str):
        e = expense_index.get(eid) or {}
        return (e.get("due_date") or e.get("incurred_on") or "9999-12-31", eid)

    for p in legacy_payments:
        remaining = float(p.get("amount") or 0.0)
        if remaining <= 0:
            continue
        ordered = sorted(p.get("applied_expense_ids") or [], key=_due_key)
        for eid in ordered:
            if remaining <= 0.001:
                break
            e = expense_index.get(eid)
            if not e:
                continue
            already = paid_map.get(eid, 0.0)
            owed = max(0.0, float(e.get("amount") or 0.0) - already)
            if owed <= 0.001:
                continue
            apply_amt = min(owed, remaining)
            paid_map[eid] = round(already + apply_amt, 2)
            remaining = round(remaining - apply_amt, 2)
    return paid_map


def _expense_with_balance(doc: dict, paid_map: dict) -> ExpenseEntry:
    paid = float(paid_map.get(doc["id"], 0.0))
    amt = float(doc.get("amount") or 0.0)
    # If marked paid manually but no payments recorded, surface full amount as paid
    if doc.get("paid") and paid < amt:
        paid = amt
    balance = max(0.0, round(amt - paid, 2))
    doc = {**doc, "paid_amount": round(paid, 2), "balance_due": balance}
    return ExpenseEntry(**doc)


async def _refresh_expense_paid_flags(user_id: str, expense_ids) -> None:
    """Recompute and write the `paid` boolean for the given expense ids.

    Used by payment create/update/delete so paid flags never drift.
    """
    if not expense_ids:
        return
    member_ids = await _household_user_ids(user_id)
    paid_map = await _build_paid_map(user_id)
    for eid in expense_ids:
        exp = await db.expenses.find_one(
            {"id": eid, "user_id": {"$in": member_ids}},
            {"_id": 0, "amount": 1, "paid": 1},
        )
        if not exp:
            continue
        amt = float(exp.get("amount") or 0.0)
        paid = float(paid_map.get(eid, 0.0))
        should_be_paid = paid + 1e-6 >= amt and amt > 0
        if exp.get("paid") != should_be_paid:
            await db.expenses.update_one(
                {"id": eid, "user_id": {"$in": member_ids}},
                {"$set": {"paid": should_be_paid}},
            )


# ============================================================
# Misc data shapers
# ============================================================
def _fundraiser_with_available(d: dict) -> Fundraiser:
    raised = float(d.get("amount_raised") or 0.0)
    applied = float(d.get("applied_amount") or 0.0)
    d = {**d, "available": round(max(0.0, raised - applied), 2)}
    return Fundraiser(**d)


def _hydrate_template_items(items: List[Dict[str, Any]]) -> List[PackingItem]:
    """Coerce raw item dicts to PackingItem models, assigning order if missing."""
    out: List[PackingItem] = []
    for i, raw in enumerate(items or []):
        it = raw if isinstance(raw, PackingItem) else PackingItem(**raw)
        if it.order == 0:
            it.order = i
        out.append(it)
    return out


def _checklist_from_template_items(items: List[PackingItem]) -> List[PackingChecklistItem]:
    return [
        PackingChecklistItem(label=i.label, category=i.category, order=i.order)
        for i in items
    ]
