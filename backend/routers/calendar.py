from typing import List, Optional

from fastapi import APIRouter, Depends

from core.db import db
from core.security import get_current_user
from core.helpers import (
    _household_user_ids, _build_paid_map, _fmt_time_12h, _extract_hhmm,
)

router = APIRouter(prefix="/api")


@router.get("/calendar")
async def calendar_feed(
    start: Optional[str] = None,
    end: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    """Return all dated events for the user in [start, end] (ISO YYYY-MM-DD).
    Items: due dates (expense), competitions, hotel check-in/out, flight depart/arrive, fundraisers.
    Each item: { id, kind, date, title, subtitle?, amount?, color, athlete_id?, link }
    """
    user_id = current_user["id"]

    def _normalize_date(value: Optional[str]) -> Optional[str]:
        """Normalize a date string into ISO YYYY-MM-DD.
        Accepts: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM[:SS]', 'DD-MM-YYYY [HH:MM]', 'DD/MM/YYYY'.
        Returns None if unparseable.
        """
        if not value:
            return None
        v = str(value).strip()
        if not v:
            return None
        first10 = v[:10]
        if len(first10) == 10 and first10[4] == "-" and first10[7] == "-":
            try:
                from datetime import date as _date
                _date.fromisoformat(first10)
                return first10
            except Exception:
                pass
        head = v.split(" ")[0].replace("/", "-")
        parts = head.split("-")
        if len(parts) == 3:
            a, b, c = parts
            try:
                if len(c) == 4 and len(a) <= 2 and len(b) <= 2:
                    return f"{int(c):04d}-{int(b):02d}-{int(a):02d}"
                if len(a) == 4 and len(b) <= 2 and len(c) <= 2:
                    return f"{int(a):04d}-{int(b):02d}-{int(c):02d}"
            except Exception:
                return None
        return None

    def in_range(d: Optional[str]) -> bool:
        if not d:
            return False
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    def iter_days(start_date: Optional[str], end_date: Optional[str]):
        """Yield ISO date strings from start_date to end_date inclusive."""
        from datetime import datetime, timedelta
        if not start_date:
            return
        try:
            d1 = datetime.fromisoformat(_normalize_date(start_date)).date()
        except Exception:
            return
        try:
            d2 = datetime.fromisoformat(_normalize_date(end_date or start_date)).date()
        except Exception:
            d2 = d1
        if d2 < d1:
            d1, d2 = d2, d1
        delta = (d2 - d1).days
        for offset in range(delta + 1):
            yield (d1 + timedelta(days=offset)).isoformat(), offset, delta

    items: List[dict] = []

    # Athletes map for names
    athletes = {
        a["id"]: a
        async for a in db.athletes.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1, "avatar_color": 1})
    }

    # Expenses — emit due-date (or fall back to incurred_on if due_date is missing)
    paid_map = await _build_paid_map(user_id)
    async for e in db.expenses.find({"user_id": user_id}, {"_id": 0}):
        ath = athletes.get(e.get("athlete_id"), {})
        amt = float(e.get("amount") or 0)
        paid = float(paid_map.get(e.get("id"), 0.0))
        bal = max(0.0, round(amt - paid, 2))
        if e.get("paid") or bal <= 0.001:
            continue
        raw = e.get("due_date") or e.get("incurred_on")
        day = _normalize_date(raw)
        if not day or not in_range(day):
            continue
        items.append({
            "id": f"expense-due-{e['id']}",
            "kind": "expense_due",
            "date": day,
            "title": f"{e.get('category', 'Expense')} due",
            "subtitle": ath.get("name", ""),
            "amount": bal,
            "color": "#E11D48",
            "athlete_id": e.get("athlete_id"),
            "link": f"/expenses/new?id={e['id']}",
        })

    # Competitions — span every day from event_date to end_date inclusive
    async for c in db.competitions.find({"user_id": user_id}, {"_id": 0}):
        ev = c.get("event_date")
        end_d = c.get("end_date") or ev
        if not ev:
            continue
        for day, offset, delta in iter_days(ev, end_d):
            if not in_range(day):
                continue
            if delta == 0:
                title = c.get("name", "Competition")
            elif offset == 0:
                title = f"{c.get('name', 'Competition')} starts"
            elif offset == delta:
                title = f"{c.get('name', 'Competition')} ends"
            else:
                title = f"{c.get('name', 'Competition')} (day {offset + 1} of {delta + 1})"
            items.append({
                "id": f"comp-{c['id']}-{day}",
                "kind": "competition",
                "date": day,
                "title": title,
                "time": c.get("event_time") if day == ev else None,
                "subtitle": (
                    f"{_fmt_time_12h(c.get('event_time'))}" + (f" \u00b7 {c.get('location')}" if c.get("location") else "")
                    if c.get("event_time") and day == ev
                    else c.get("location") or ""
                ),
                "color": "#007CFF",
                "link": f"/competitions/{c['id']}",
            })

    # Bookings — hotels, flights, ground
    async for b in db.bookings.find({"user_id": user_id}, {"_id": 0}):
        btype = b.get("type", "booking")
        comp_link = f"/competitions/{b.get('competition_id')}" if b.get("competition_id") else "/"
        vendor = b.get("provider") or btype.capitalize()
        conf = b.get("confirmation") or ""
        if btype == "hotel":
            ci, co = _normalize_date(b.get("check_in")), _normalize_date(b.get("check_out"))
            if ci:
                for day, offset, delta in iter_days(ci, co or ci):
                    if not in_range(day):
                        continue
                    if delta == 0:
                        title = f"Hotel: {vendor}"
                        kind = "hotel_checkin"
                    elif offset == 0:
                        title = f"Check-in: {vendor}"
                        kind = "hotel_checkin"
                    elif offset == delta:
                        title = f"Check-out: {vendor}"
                        kind = "hotel_checkout"
                    else:
                        title = f"Stay: {vendor} (night {offset + 1} of {delta + 1})"
                        kind = "hotel_stay"
                    sub_parts = []
                    item_time: Optional[str] = None
                    if kind == "hotel_checkin" and b.get("check_in_time"):
                        sub_parts.append(f"Check-in {_fmt_time_12h(b.get('check_in_time'))}")
                        item_time = b.get("check_in_time")
                    elif kind == "hotel_checkout" and b.get("check_out_time"):
                        sub_parts.append(f"Check-out {_fmt_time_12h(b.get('check_out_time'))}")
                        item_time = b.get("check_out_time")
                    if conf:
                        sub_parts.append(conf)
                    items.append({
                        "id": f"hotel-{b['id']}-{day}",
                        "kind": kind,
                        "date": day,
                        "title": title,
                        "time": item_time,
                        "subtitle": " \u00b7 ".join(sub_parts) if sub_parts else conf,
                        "color": "#7C3AED",
                        "link": comp_link,
                    })
        elif btype == "flight":
            dep = _normalize_date(b.get("depart_time"))
            ret = _normalize_date(b.get("return_depart_time"))
            dep_t = _fmt_time_12h(b.get("depart_time"))
            ret_t = _fmt_time_12h(b.get("return_depart_time"))
            if dep and in_range(dep):
                base_sub = f"{vendor} {b.get('flight_number') or ''}".strip()
                sub = f"Depart {dep_t} \u00b7 {base_sub}".strip(" \u00b7 ") if dep_t else base_sub
                items.append({
                    "id": f"flight-dep-{b['id']}",
                    "kind": "flight_depart",
                    "date": dep,
                    "title": f"Flight {b.get('depart_airport') or ''} → {b.get('arrive_airport') or ''}".strip(),
                    "time": _extract_hhmm(b.get("depart_time")),
                    "end_time": _extract_hhmm(b.get("arrive_time")),
                    "subtitle": sub,
                    "color": "#7C3AED",
                    "link": comp_link,
                })
            if ret and in_range(ret):
                base_sub = f"{b.get('return_airline') or vendor} {b.get('return_flight_number') or ''}".strip()
                sub = f"Depart {ret_t} \u00b7 {base_sub}".strip(" \u00b7 ") if ret_t else base_sub
                items.append({
                    "id": f"flight-ret-{b['id']}",
                    "kind": "flight_return",
                    "date": ret,
                    "title": f"Return {b.get('return_depart_airport') or ''} → {b.get('return_arrive_airport') or ''}".strip(),
                    "time": _extract_hhmm(b.get("return_depart_time")),
                    "end_time": _extract_hhmm(b.get("return_arrive_time")),
                    "subtitle": sub,
                    "color": "#7C3AED",
                    "link": comp_link,
                })
            if dep and ret:
                for day, offset, delta in iter_days(dep, ret):
                    if offset == 0 or offset == delta:
                        continue
                    if in_range(day):
                        items.append({
                            "id": f"flight-trip-{b['id']}-{day}",
                            "kind": "travel_day",
                            "date": day,
                            "title": "Travel day",
                            "subtitle": vendor,
                            "color": "#7C3AED",
                            "link": comp_link,
                        })
        else:  # ground / other
            d = b.get("check_in") or (b.get("depart_time") or "")[:10] or None
            if in_range(d):
                items.append({
                    "id": f"trans-{b['id']}",
                    "kind": "transport",
                    "date": d,
                    "title": vendor,
                    "subtitle": btype,
                    "color": "#7C3AED",
                    "link": comp_link,
                })

    # Fundraisers — raised_on
    member_ids = await _household_user_ids(user_id)
    async for f in db.fundraisers.find({"user_id": {"$in": member_ids}}, {"_id": 0}):
        if in_range(f.get("raised_on")):
            items.append({
                "id": f"fund-{f['id']}",
                "kind": "fundraiser",
                "date": f["raised_on"],
                "title": f.get("name", "Fundraiser"),
                "subtitle": "Raised",
                "amount": float(f.get("amount_raised") or 0.0),
                "color": "#16A34A",
                "link": "/fundraisers",
            })

    # Schedule events
    async for s in db.schedule_events.find({"user_id": {"$in": member_ids}}, {"_id": 0}):
        day = _normalize_date(s.get("date"))
        if not day or not in_range(day):
            continue
        et = s.get("event_type", "practice")
        colors_by_type = {
            "practice": "#EA580C",
            "team_bonding": "#0EA5E9",
            "private_lesson": "#DB2777",
            "choreography": "#9333EA",
            "class": "#0891B2",
            "other": "#64748B",
        }
        time_str = ""
        if s.get("start_time"):
            time_str = _fmt_time_12h(s["start_time"])
            if s.get("end_time"):
                time_str += f" – {_fmt_time_12h(s['end_time'])}"
        subtitle = " · ".join([x for x in [time_str, s.get("location") or ""] if x])
        items.append({
            "id": f"schedule-{s['id']}",
            "kind": "schedule",
            "date": day,
            "title": s.get("title", "Event"),
            "subtitle": subtitle,
            "color": colors_by_type.get(et, "#64748B"),
            "link": f"/schedule/new?id={s['id']}",
        })

    # Team meet/performance times (per-team multi-day schedule per competition)
    teams_by_id = {
        t["id"]: t async for t in db.teams.find(
            {"user_id": {"$in": member_ids}},
            {"_id": 0, "id": 1, "name": 1, "color": 1, "logo_image": 1},
        )
    }
    async for c in db.competitions.find({"user_id": user_id}, {"_id": 0}):
        comp_id = c.get("id")
        comp_link = f"/competitions/{comp_id}"
        comp_event_date = c.get("event_date")
        comp_location = c.get("location") or ""
        meet_times = c.get("team_meet_times") or []
        for idx, mt in enumerate(meet_times):
            t = teams_by_id.get(mt.get("team_id"))
            team_name = (t or {}).get("name") or "Team"
            team_color = (t or {}).get("color") or "#0EA5E9"
            day = _normalize_date(mt.get("date")) or _normalize_date(comp_event_date)
            if not day or not in_range(day):
                continue
            perf_loc = mt.get("performance_location") or comp_location
            mt_time = mt.get("meet_time")
            if mt_time:
                subtitle_bits = [f"Team meet · {_fmt_time_12h(mt_time)}"]
                if perf_loc:
                    subtitle_bits.append(perf_loc)
                items.append({
                    "id": f"team-meet-{comp_id}-{idx}",
                    "kind": "team_meet",
                    "date": day,
                    "title": f"{team_name} — meet",
                    "time": mt_time,
                    "subtitle": " · ".join(subtitle_bits),
                    "color": team_color,
                    "logo_image": (t or {}).get("logo_image"),
                    "link": comp_link,
                })
            perf_time = mt.get("performance_time")
            if perf_time:
                subtitle_bits = [f"Performance · {_fmt_time_12h(perf_time)}"]
                if perf_loc:
                    subtitle_bits.append(perf_loc)
                items.append({
                    "id": f"team-perf-{comp_id}-{idx}",
                    "kind": "team_performance",
                    "date": day,
                    "title": f"{team_name} — performance",
                    "time": perf_time,
                    "subtitle": " · ".join(subtitle_bits),
                    "color": team_color,
                    "logo_image": (t or {}).get("logo_image"),
                    "link": comp_link,
                })
            if not mt_time and not perf_time and mt.get("date"):
                items.append({
                    "id": f"team-day-{comp_id}-{idx}",
                    "kind": "team_performance",
                    "date": day,
                    "title": f"{team_name} performance day",
                    "subtitle": perf_loc,
                    "color": team_color,
                    "logo_image": (t or {}).get("logo_image"),
                    "link": comp_link,
                })

        # Teams to Watch (external teams the user is spectating)
        for widx, w in enumerate(c.get("teams_to_watch") or []):
            day = _normalize_date(w.get("date")) or _normalize_date(comp_event_date)
            if not day or not in_range(day):
                continue
            wt_time = w.get("performance_time")
            subtitle_bits = []
            if wt_time:
                subtitle_bits.append(_fmt_time_12h(wt_time))
            if w.get("location"):
                subtitle_bits.append(w["location"])
            subtitle_bits.append("Team to watch")
            items.append({
                "id": f"watch-{comp_id}-{widx}",
                "kind": "team_to_watch",
                "date": day,
                "title": w.get("name") or "Team to watch",
                "time": wt_time,
                "subtitle": " · ".join(subtitle_bits),
                "color": "#0EA5E9",
                "link": comp_link,
            })

    items.sort(key=lambda x: x["date"])
    return {"items": items}
