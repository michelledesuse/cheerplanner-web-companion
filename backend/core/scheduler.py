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
from core.sms import send_sms
from core.config import WEB_FALLBACK_URL

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None
# Default if a user hasn't set a timezone or has a bad value.
DEFAULT_TZ = "America/New_York"
DEFAULT_SEND_HOUR_LOCAL = 8  # 8 AM in user's tz
# S1: allowed lead-time offsets (minutes before the target moment).
ALLOWED_SMS_OFFSETS = {60, 30, 15, 1}
CHECKIN_LEAD_MINUTES = 24 * 60  # flight check-in opens 24h before departure


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
    # S1: every minute — precise lead-time SMS reminders for booking openings
    # and flight check-in windows (per-event offsets).
    _scheduler.add_job(
        send_timed_sms_tick,
        CronTrigger(second=0),
        id="timed_sms_tick",
        replace_existing=True,
        misfire_grace_time=120,
    )
    _scheduler.start()
    logger.info("Scheduler started \u2014 digest tick hourly at :05 UTC, timed-SMS tick every minute")
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
# S1 — Timed lead-time SMS reminders (runs every minute)
# ============================================================
def _valid_offsets(raw: Any) -> List[int]:
    """Keep only recognized offsets, deduped, descending (60,30,15,1)."""
    out: List[int] = []
    for x in (raw or []):
        try:
            v = int(x)
        except Exception:
            continue
        if v in ALLOWED_SMS_OFFSETS and v not in out:
            out.append(v)
    return sorted(out, reverse=True)


def _fmt_offset(off: int) -> str:
    return "1 hour" if off == 60 else f"{off} min"


async def _already_sent(key: str) -> bool:
    return bool(await db.sent_notifications.find_one({"key": key}, {"_id": 0}))


async def _record_sent(key: str, user_id: str, kind: str) -> None:
    await db.sent_notifications.insert_one({
        "key": key,
        "user_id": user_id,
        "kind": kind,
        "sent_at": datetime.utcnow().isoformat() + "Z",
    })


def _booking_open_sms(comp: Dict[str, Any], off: int) -> str:
    name = comp.get("name") or "your competition"
    return (
        f"CheerPlanner: Hotel booking for {name} opens in {_fmt_offset(off)}. "
        f"Be ready to grab your stay-to-play room.\nReply STOP to opt out."
    )


def _checkin_sms(leg_id: str, dep_ap: Any, arr_ap: Any, off: int) -> str:
    route = " \u2192 ".join([x for x in [dep_ap, arr_ap] if x]) or "your flight"
    leg = "return " if leg_id == "ret" else ""
    return (
        f"CheerPlanner: Check-in for your {leg}flight {route} opens in {_fmt_offset(off)}. "
        f"Get ready to check in.\nReply STOP to opt out."
    )


async def send_timed_sms_tick() -> None:
    """Every minute: fire precise SMS reminders for stay-to-play booking
    openings and flight check-in windows, per-event offsets, per-offset dedupe.
    Only for users who opted into SMS with a valid number.
    """
    from core.helpers import _household_user_ids, parse_local_datetime
    from core.sms import normalize_us_phone

    now_utc = datetime.utcnow().replace(tzinfo=ZoneInfo("UTC"))
    sent = 0

    def _due(now_naive: datetime, fire_at: datetime) -> bool:
        # Tolerant window (dedupe prevents duplicates across ticks/misfires).
        delta = (now_naive - fire_at).total_seconds()
        return 0 <= delta < 120

    cursor = db.users.find({}, {"_id": 0, "id": 1, "notification_preferences": 1})
    async for u in cursor:
        try:
            prefs = u.get("notification_preferences") or {}
            if not prefs.get("enabled", True):
                continue
            if not prefs.get("sms_enabled") or not prefs.get("sms_phone"):
                continue
            phone = normalize_us_phone(prefs.get("sms_phone"))
            if not phone:
                continue
            tz_name = prefs.get("timezone") or DEFAULT_TZ
            try:
                tz = ZoneInfo(tz_name)
            except ZoneInfoNotFoundError:
                tz = ZoneInfo(DEFAULT_TZ)
            local_now = now_utc.astimezone(tz).replace(tzinfo=None)
            user_id = u["id"]
            member_ids = await _household_user_ids(user_id)

            # --- Stay-to-play booking openings ---
            async for c in db.competitions.find(
                {"user_id": {"$in": member_ids},
                 "sms_reminder_offsets": {"$exists": True, "$ne": []}},
                {"_id": 0},
            ):
                offsets = _valid_offsets(c.get("sms_reminder_offsets"))
                target_dt = parse_local_datetime(c.get("booking_release_at"))
                if not offsets or not target_dt:
                    continue
                for off in offsets:
                    if not _due(local_now, target_dt - timedelta(minutes=off)):
                        continue
                    key = f"{user_id}:comp:{c['id']}:booking_open:{off}"
                    if await _already_sent(key):
                        continue
                    if send_sms(phone, _booking_open_sms(c, off)):
                        await _record_sent(key, user_id, "sms_booking_open")
                        sent += 1

            # --- Flight check-in windows (24h before each leg's departure) ---
            async for b in db.bookings.find(
                {"user_id": {"$in": member_ids}, "type": "flight",
                 "sms_reminder_offsets": {"$exists": True, "$ne": []}},
                {"_id": 0},
            ):
                offsets = _valid_offsets(b.get("sms_reminder_offsets"))
                if not offsets:
                    continue
                legs = [
                    ("out", b.get("depart_time"), b.get("depart_airport"), b.get("arrive_airport")),
                    ("ret", b.get("return_depart_time"), b.get("return_depart_airport"), b.get("return_arrive_airport")),
                ]
                for leg_id, dep_raw, dep_ap, arr_ap in legs:
                    dep_dt = parse_local_datetime(dep_raw)
                    if not dep_dt:
                        continue
                    checkin_open = dep_dt - timedelta(minutes=CHECKIN_LEAD_MINUTES)
                    for off in offsets:
                        if not _due(local_now, checkin_open - timedelta(minutes=off)):
                            continue
                        key = f"{user_id}:booking:{b['id']}:checkin_{leg_id}:{off}"
                        if await _already_sent(key):
                            continue
                        if send_sms(phone, _checkin_sms(leg_id, dep_ap, arr_ap, off)):
                            await _record_sent(key, user_id, "sms_checkin")
                            sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("timed sms tick failure for user %s: %s", u.get("id"), exc)
    if sent:
        logger.info("Timed SMS tick: sent=%d", sent)


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

    # SMS reminder (v2.4) — separate opt-in + dedupe so it's independent of email.
    if prefs.get("sms_enabled") and prefs.get("sms_phone"):
        sms_key = f"{user_id}:{local_today.isoformat()}:sms:{freq}"
        sms_already = await db.sent_notifications.find_one({"key": sms_key}, {"_id": 0})
        if not sms_already:
            sms_ok = send_sms(prefs["sms_phone"], _build_sms_body(sections, total))
            if sms_ok:
                await db.sent_notifications.insert_one({
                    "key": sms_key,
                    "user_id": user_id,
                    "kind": f"digest_sms:{freq}",
                    "date": local_today.isoformat(),
                    "sent_at": datetime.utcnow().isoformat() + "Z",
                    "item_count": total,
                })
    return ok


def _build_sms_body(sections: List[Dict[str, Any]], total: int) -> str:
    """Compact reminder text: count + up to 3 items + STOP notice."""
    lines = [f"CheerPlanner: {total} upcoming reminder{'s' if total != 1 else ''}."]
    shown = 0
    for s in sections:
        for it in s.get("items", []):
            if shown >= 3:
                break
            amt = f" {it['amount']}" if it.get("amount") else ""
            when = it.get("when") or ""
            lines.append(f"- {it.get('title', '')}{amt}" + (f" ({when})" if when else ""))
            shown += 1
        if shown >= 3:
            break
    if total > shown:
        lines.append(f"...and {total - shown} more. Open the app for details.")
    lines.append("Reply STOP to opt out.")
    return "\n".join(lines)


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
