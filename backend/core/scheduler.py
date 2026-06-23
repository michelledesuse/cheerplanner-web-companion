"""APScheduler entry-point.

A single AsyncIOScheduler instance runs inside the FastAPI process.
Right now it has ONE job:

  * `send_digest_tick` — fires every hour. For each user whose timezone hour
    equals their preferred send hour (8 AM local by default), and whose
    `frequency` matches today (daily, or weekly = Monday), build a digest
    from `/api/reminders` style data and email it. Idempotency is guaranteed
    by the `sent_notifications` collection keyed on (user_id, YYYY-MM-DD,
    kind="digest").

The scheduler is started from the FastAPI startup hook in server.py.
"""
from __future__ import annotations

import logging
from datetime import datetime, date, timedelta
from typing import Any, Dict, List
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from core.db import db
from core.email import send_email, make_unsubscribe_token
from core.email_templates import render_digest
from core.config import WEB_FALLBACK_URL

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None
# Default if a user hasn't set a timezone or has a bad value.
DEFAULT_TZ = "America/New_York"
DEFAULT_SEND_HOUR_LOCAL = 8  # 8 AM in user's tz


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler:
        return _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    # Every hour at :05 — we then decide per-user whether to send.
    _scheduler.add_job(
        send_digest_tick,
        CronTrigger(minute=5),
        id="digest_tick",
        replace_existing=True,
        misfire_grace_time=600,
    )
    _scheduler.start()
    logger.info("Scheduler started \u2014 digest tick runs every hour at :05 UTC")
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None


# ============================================================
# Digest tick (runs every hour, picks the right users)
# ============================================================
async def send_digest_tick() -> None:
    """Look at every user, see if their local time is the configured send
    hour AND if their frequency window matches today, then send.
    """
    now_utc = datetime.utcnow().replace(tzinfo=ZoneInfo("UTC"))
    sent_count = 0
    skipped = 0
    failed = 0
    cursor = db.users.find({}, {"_id": 0, "id": 1, "email": 1, "name": 1, "notification_preferences": 1})
    async for u in cursor:
        try:
            prefs = u.get("notification_preferences") or {}
            if not prefs.get("enabled", True):
                skipped += 1
                continue
            freq = prefs.get("frequency", "daily")
            if freq not in ("daily", "weekly"):
                skipped += 1
                continue
            tz_name = prefs.get("timezone") or DEFAULT_TZ
            try:
                tz = ZoneInfo(tz_name)
            except ZoneInfoNotFoundError:
                tz = ZoneInfo(DEFAULT_TZ)
            local_now = now_utc.astimezone(tz)
            if local_now.hour != DEFAULT_SEND_HOUR_LOCAL:
                continue
            # Weekly digest only on Monday (weekday=0).
            if freq == "weekly" and local_now.weekday() != 0:
                continue
            ok = await _send_digest_for_user(u, prefs, local_now.date(), freq)
            if ok is None:
                skipped += 1
            elif ok:
                sent_count += 1
            else:
                failed += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("digest tick failure for user %s: %s", u.get("id"), exc)
            failed += 1
    if sent_count or failed:
        logger.info("Digest tick: sent=%d skipped=%d failed=%d", sent_count, skipped, failed)


async def _send_digest_for_user(
    user: Dict[str, Any], prefs: Dict[str, Any], local_today: date, freq: str,
) -> bool | None:
    """Build + email the digest. Returns True on send, False on failure,
    None if skipped (no items / already sent today)."""
    user_id = user["id"]
    kind = f"digest:{freq}"
    dedupe_key = f"{user_id}:{local_today.isoformat()}:{kind}"
    already = await db.sent_notifications.find_one({"key": dedupe_key}, {"_id": 0})
    if already:
        return None
    sections = await _build_digest_sections(
        user_id=user_id, today=local_today, frequency=freq, prefs=prefs,
    )
    total = sum(len(s["items"]) for s in sections)
    if total == 0:
        # Don't send empty digests — mark sent so we don't re-evaluate every tick.
        await db.sent_notifications.insert_one({
            "key": dedupe_key,
            "user_id": user_id,
            "kind": kind,
            "date": local_today.isoformat(),
            "sent_at": datetime.utcnow().isoformat() + "Z",
            "empty": True,
        })
        return None
    unsub_token = make_unsubscribe_token(user_id)
    subject, html, text = render_digest(
        name=user.get("name"),
        sections=sections,
        frequency=freq,
        unsubscribe_token=unsub_token,
        web_url=WEB_FALLBACK_URL,
    )
    ok = send_email(to=user["email"], subject=subject, html=html, text=text)
    if ok:
        await db.sent_notifications.insert_one({
            "key": dedupe_key,
            "user_id": user_id,
            "kind": kind,
            "date": local_today.isoformat(),
            "sent_at": datetime.utcnow().isoformat() + "Z",
            "item_count": total,
        })
    return ok


# ============================================================
# Digest sections builder — mirrors /api/reminders semantics
# ============================================================
async def _build_digest_sections(
    user_id: str,
    today: date,
    frequency: str,
    prefs: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Returns a list of grouped sections suitable for `render_digest()`."""
    # Reuse the same helpers the reminders endpoint uses.
    from core.helpers import _household_user_ids, parse_date

    member_ids = await _household_user_ids(user_id)
    horizon = 14 if frequency == "weekly" else 7
    cats = (prefs.get("categories") or {})

    def _within(due_value: Any) -> bool:
        d = parse_date(due_value)
        if not d:
            return False
        delta = (d - today).days
        return 0 <= delta <= horizon  # only show upcoming, not overdue (keep digest concise)

    def _money(amount: Any) -> str | None:
        if amount is None:
            return None
        try:
            return f"${float(amount):,.2f}"
        except Exception:
            return None

    def _when_label(due: str) -> str:
        d = parse_date(due)
        if not d:
            return ""
        delta = (d - today).days
        if delta == 0:
            return "Today"
        if delta == 1:
            return "Tomorrow"
        if delta < 7:
            return f"In {delta} days \u2014 {d.strftime('%a %b %-d')}"
        return d.strftime("%a %b %-d")

    sections: List[Dict[str, Any]] = []

    # Athlete lookup for nicer subtitles.
    athlete_map: Dict[str, str] = {}
    async for a in db.athletes.find(
        {"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1},
    ):
        athlete_map[a["id"]] = a.get("name", "")

    # --- Expense due ---
    if cats.get("expense_due", True):
        items: List[Dict[str, Any]] = []
        async for e in db.expenses.find(
            {"user_id": {"$in": member_ids}, "paid": False, "due_date": {"$ne": None}}, {"_id": 0},
        ):
            if not _within(e.get("due_date")):
                continue
            items.append({
                "title": f"{e.get('category', 'Expense')} due",
                "subtitle": athlete_map.get(e.get("athlete_id"), ""),
                "when": _when_label(e["due_date"]),
                "amount": _money(e.get("amount")),
            })
        if items:
            sections.append({"title": "Payments due", "items": items})

    # --- Booking balance ---
    if cats.get("booking_balance", True):
        items = []
        async for b in db.bookings.find(
            {"user_id": {"$in": member_ids}, "balance_due_date": {"$ne": None}}, {"_id": 0},
        ):
            bal = float(b.get("cost") or 0) - float(b.get("amount_paid") or 0)
            if bal <= 0 or not _within(b.get("balance_due_date")):
                continue
            items.append({
                "title": f"{(b.get('type') or '').title()} balance",
                "subtitle": b.get("provider") or "",
                "when": _when_label(b["balance_due_date"]),
                "amount": _money(bal),
            })
        if items:
            sections.append({"title": "Travel balances", "items": items})

    # --- Booking cancel-by ---
    if cats.get("booking_cancel_by", True):
        items = []
        async for b in db.bookings.find(
            {"user_id": {"$in": member_ids}, "cancel_by": {"$ne": None}, "type": "hotel"}, {"_id": 0},
        ):
            if not _within(b.get("cancel_by")):
                continue
            items.append({
                "title": f"Cancel deadline: {b.get('provider') or 'Hotel'}",
                "subtitle": "Last day to cancel without fees",
                "when": _when_label(b["cancel_by"]),
                "amount": None,
            })
        if items:
            sections.append({"title": "Cancel-by deadlines", "items": items})

    # --- Booking release ---
    if cats.get("booking_release", True):
        items = []
        async for c in db.competitions.find(
            {"user_id": {"$in": member_ids}, "booking_release_at": {"$ne": None}}, {"_id": 0},
        ):
            if not _within(c.get("booking_release_at")):
                continue
            items.append({
                "title": f"Booking opens: {c.get('name', '')}",
                "subtitle": c.get("location") or "",
                "when": _when_label(c["booking_release_at"]),
                "amount": None,
            })
        if items:
            sections.append({"title": "Hotel booking windows", "items": items})

    # --- Competitions (this week) ---
    if cats.get("competition_event", True):
        items = []
        async for c in db.competitions.find({"user_id": {"$in": member_ids}}, {"_id": 0}):
            if not _within(c.get("event_date")):
                continue
            items.append({
                "title": c.get("name", "Competition"),
                "subtitle": c.get("location") or "",
                "when": _when_label(c["event_date"]),
                "amount": None,
            })
        if items:
            sections.append({"title": "Upcoming competitions", "items": items})

    # --- Packing list nudges (comp ≤ 7 days out, list has unchecked items) ---
    if cats.get("packing", True):
        items = []
        async for c in db.competitions.find({"user_id": {"$in": member_ids}}, {"_id": 0}):
            d = parse_date(c.get("event_date"))
            if not d:
                continue
            days = (d - today).days
            if days < 0 or days > 7:
                continue
            pl = await db.packing_lists.find_one(
                {"competition_id": c["id"], "user_id": {"$in": member_ids}}, {"_id": 0},
            )
            unchecked = 0
            if pl:
                for it in (pl.get("items") or []):
                    cb = it.get("checked_by") or {}
                    keys = list(cb.keys()) or ["shared"]
                    for k in keys:
                        if not cb.get(k):
                            unchecked += 1
            else:
                unchecked = 1
            if unchecked <= 0:
                continue
            items.append({
                "title": f"Pack for {c.get('name', 'competition')}",
                "subtitle": f"{unchecked} item{'s' if unchecked != 1 else ''} left" if pl else "Tap to create a packing list",
                "when": _when_label(c["event_date"]),
                "amount": None,
            })
        if items:
            sections.append({"title": "Packing", "items": items})

    return sections
