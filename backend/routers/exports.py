import csv as _csv
import io as _io
from typing import List

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from core.db import db
from core.models import utcnow_iso
from core.security import get_current_user
from core.helpers import _household_user_ids, _build_paid_map
from routers.calendar import calendar_feed

router = APIRouter(prefix="/api")


@router.get("/export/expenses-payments.csv", response_class=PlainTextResponse)
async def export_expenses_payments_csv(current_user=Depends(get_current_user)):
    """One combined CSV containing both expenses and payments for the household.

    A `type` column distinguishes the row kind so users can sort/filter in Excel.
    """
    user_ids = await _household_user_ids(current_user["id"])
    ath_map = {
        a["id"]: a["name"]
        async for a in db.athletes.find({"user_id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1})
    }
    cat_map = {
        e["id"]: e.get("category", "")
        async for e in db.expenses.find({"user_id": {"$in": user_ids}}, {"_id": 0, "id": 1, "category": 1})
    }
    paid_map = await _build_paid_map(current_user["id"])

    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow([
        "Type", "Date", "Athlete", "Category", "Amount", "Paid Amount",
        "Balance Due", "Due Date", "Status", "Method", "Applied To", "Note", "ID",
    ])

    rows: List[List[str]] = []
    async for e in db.expenses.find({"user_id": {"$in": user_ids}}, {"_id": 0}).sort("incurred_on", -1):
        amt = float(e.get("amount") or 0)
        paid = float(paid_map.get(e["id"], 0.0))
        bal = max(0.0, round(amt - paid, 2))
        rows.append([
            "Expense",
            e.get("incurred_on", ""),
            ath_map.get(e.get("athlete_id"), ""),
            e.get("category", ""),
            f"{amt:.2f}",
            f"{paid:.2f}",
            f"{bal:.2f}",
            e.get("due_date") or "",
            "Paid" if e.get("paid") else ("Partial" if paid > 0 else "Unpaid"),
            "", "",  # method, applied_to (n/a for expenses)
            (e.get("note") or "").replace("\n", " "),
            e["id"],
        ])

    async for p in db.payments.find({"user_id": {"$in": user_ids}}, {"_id": 0}).sort("paid_on", -1):
        applied = ", ".join(
            cat_map.get(eid, "") for eid in (p.get("applied_expense_ids") or []) if cat_map.get(eid)
        )
        rows.append([
            "Payment",
            p.get("paid_on", ""),
            ath_map.get(p.get("athlete_id"), ""),
            "",
            f"{float(p.get('amount') or 0):.2f}",
            "", "", "",
            "",
            p.get("method") or "",
            applied,
            (p.get("note") or "").replace("\n", " "),
            p["id"],
        ])

    rows.sort(key=lambda r: r[1] or "", reverse=True)
    for r in rows:
        w.writerow(r)

    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cheerplanner-expenses-payments.csv"},
    )


@router.get("/export/expenses.csv", response_class=PlainTextResponse)
async def export_expenses_csv(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    paid_map = await _build_paid_map(user_id)
    ath_map = {
        a["id"]: a["name"]
        async for a in db.athletes.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1})
    }
    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["id", "athlete", "category", "amount", "paid_amount", "balance_due", "incurred_on", "due_date", "paid", "note"])
    async for e in db.expenses.find({"user_id": user_id}, {"_id": 0}).sort("incurred_on", -1):
        amt = float(e.get("amount") or 0)
        paid = float(paid_map.get(e["id"], 0.0))
        bal = max(0.0, round(amt - paid, 2))
        w.writerow([
            e["id"], ath_map.get(e.get("athlete_id"), ""), e.get("category", ""),
            f"{amt:.2f}", f"{paid:.2f}", f"{bal:.2f}",
            e.get("incurred_on", ""), e.get("due_date") or "",
            "yes" if e.get("paid") else "no",
            (e.get("note") or "").replace("\n", " "),
        ])
    return PlainTextResponse(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=expenses.csv"},
    )


@router.get("/export/payments.csv", response_class=PlainTextResponse)
async def export_payments_csv(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    ath_map = {
        a["id"]: a["name"]
        async for a in db.athletes.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1})
    }
    cat_map = {
        e["id"]: e.get("category", "")
        async for e in db.expenses.find({"user_id": user_id}, {"_id": 0, "id": 1, "category": 1})
    }
    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["id", "athlete", "amount", "paid_on", "method", "applied_to", "note"])
    async for p in db.payments.find({"user_id": user_id}, {"_id": 0}).sort("paid_on", -1):
        applied = ", ".join(cat_map.get(eid, "") for eid in (p.get("applied_expense_ids") or []) if cat_map.get(eid))
        w.writerow([
            p["id"], ath_map.get(p.get("athlete_id"), ""),
            f"{float(p.get('amount') or 0):.2f}",
            p.get("paid_on", ""), p.get("method") or "", applied,
            (p.get("note") or "").replace("\n", " "),
        ])
    return PlainTextResponse(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=payments.csv"},
    )


@router.get("/export/calendar.ics", response_class=PlainTextResponse)
async def export_calendar_ics(current_user=Depends(get_current_user)):
    # Reuse the calendar feed for a wide range (1 year back to 2 years forward)
    from datetime import date as _d, timedelta as _td
    today = _d.today()
    start = (today - _td(days=365)).isoformat()
    end = (today + _td(days=730)).isoformat()
    feed = await calendar_feed(start=start, end=end, current_user=current_user)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CheerPlanner//EN", "CALSCALE:GREGORIAN"]
    now = utcnow_iso().replace("-", "").replace(":", "").replace(".", "")[:15] + "Z"
    for item in feed.get("items", []):
        d = item["date"].replace("-", "")
        uid = f"{item['id']}@cheerplanner"
        summary = (item.get("title") or "Event").replace(",", "\\,").replace(";", "\\;")
        desc = (item.get("subtitle") or "").replace(",", "\\,").replace(";", "\\;")
        # If the item carries a HH:MM time, emit a timed VEVENT in floating local
        # time (no TZID) so Apple/Google calendars treat it as the user's local zone.
        t = item.get("time")
        end_t = item.get("end_time")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now}",
        ]
        if t:
            hh, mm = t.split(":")
            lines.append(f"DTSTART:{d}T{hh}{mm}00")
            if end_t:
                eh, em = end_t.split(":")
                lines.append(f"DTEND:{d}T{eh}{em}00")
            else:
                end_h = (int(hh) + 1) % 24
                lines.append(f"DTEND:{d}T{end_h:02d}{mm}00")
        else:
            lines.append(f"DTSTART;VALUE=DATE:{d}")
        lines.append(f"SUMMARY:{summary}")
        if desc:
            lines.append(f"DESCRIPTION:{desc}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return PlainTextResponse(
        content="\r\n".join(lines), media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=cheerplanner.ics"},
    )
