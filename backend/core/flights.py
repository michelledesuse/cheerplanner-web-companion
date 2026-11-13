"""Flight itinerary helpers.

A flight booking can hold several segments (each leg/connection, outbound or
return, with its own passengers) plus a per-direction fare breakdown. The
legacy flat fields (flight_number, depart_time, return_*, outbound_cost, ...)
are kept in sync from these so older screens, imports and reminders still work.

fare = {"outbound": Leg, "return": Leg}
Leg  = {passengers, base_fare, taxes_fees (both per passenger), bag_fees,
        seat_fees (totals), amount_paid, paid_on}
"""
import uuid
from typing import Optional

_SEG_FIELDS = ("airline", "confirmation", "flight_number", "depart_airport", "depart_time",
               "arrive_airport", "arrive_time")
_MONEY = ("base_fare", "taxes_fees", "bag_fees", "seat_fees", "amount_paid")


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def leg_total(leg: Optional[dict]) -> float:
    if not leg:
        return 0.0
    pax = max(int(_num(leg.get("passengers")) or 1), 1)
    return round(pax * (_num(leg.get("base_fare")) + _num(leg.get("taxes_fees")))
                 + _num(leg.get("bag_fees")) + _num(leg.get("seat_fees")), 2)


def _leg_has_values(leg: Optional[dict]) -> bool:
    return bool(leg) and any(_num(leg.get(k)) for k in _MONEY)


def effective_cost(b: dict) -> float:
    """A booking's cost; for flights saved with cost 0/empty, derive it from
    the fare legs, else from the legacy outbound/return costs."""
    cost = _num(b.get("cost"))
    if cost > 0 or b.get("type") != "flight":
        return cost
    fare = b.get("fare") if isinstance(b.get("fare"), dict) else {}
    legs = [fare.get(d) for d in ("outbound", "return") if _leg_has_values(fare.get(d))]
    if legs:
        return round(sum(leg_total(l) for l in legs), 2)
    return round(_num(b.get("outbound_cost")) + _num(b.get("return_cost")), 2)


def booking_balance(b: dict) -> float:
    """What's still owed on one booking — never below zero."""
    return max(0.0, round(effective_cost(b) - _num(b.get("amount_paid")), 2))


def flight_segments(b: dict) -> list:
    """Segments for a flight booking (legacy flat fields become 1–2 segments)."""
    segs = [s for s in (b.get("segments") or []) if isinstance(s, dict)]
    if segs:
        return segs
    out = []
    if b.get("depart_time") or b.get("flight_number") or b.get("depart_airport"):
        out.append({"id": "out", "direction": "outbound", "airline": b.get("provider"),
                    "confirmation": b.get("confirmation"), "flight_number": b.get("flight_number"),
                    "depart_airport": b.get("depart_airport"), "depart_time": b.get("depart_time"),
                    "arrive_airport": b.get("arrive_airport"), "arrive_time": b.get("arrive_time"),
                    "passengers": []})
    if b.get("return_depart_time") or b.get("return_flight_number") or b.get("return_depart_airport"):
        out.append({"id": "ret", "direction": "return",
                    "airline": b.get("return_airline") or b.get("provider"),
                    "confirmation": b.get("return_confirmation") or b.get("confirmation"),
                    "flight_number": b.get("return_flight_number"),
                    "depart_airport": b.get("return_depart_airport"), "depart_time": b.get("return_depart_time"),
                    "arrive_airport": b.get("return_arrive_airport"), "arrive_time": b.get("return_arrive_time"),
                    "passengers": []})
    return out


def sorted_segments(b: dict) -> list:
    return sorted(flight_segments(b), key=lambda s: str(s.get("depart_time") or "9999"))


def _clean_segments(segs: list) -> list:
    clean = []
    for s in segs or []:
        if not isinstance(s, dict):
            continue
        seg = {k: (str(s.get(k)).strip() if s.get(k) not in (None, "") else None) for k in _SEG_FIELDS}
        for k in ("depart_airport", "arrive_airport"):
            if seg[k]:
                seg[k] = seg[k].upper()
        if not any(seg.values()):
            continue
        seg["id"] = s.get("id") or str(uuid.uuid4())  # stable ids keep check-in texts deduped
        seg["direction"] = "return" if s.get("direction") == "return" else "outbound"
        pax = s.get("passengers") or []
        if isinstance(pax, str):
            pax = [p for p in (x.strip() for x in pax.split(",")) if p]
        seg["passengers"] = [str(p).strip() for p in pax if str(p).strip()]
        clean.append(seg)
    return sorted(clean, key=lambda s: str(s.get("depart_time") or "9999"))


def apply_flight_rollups(data: dict) -> dict:
    """Mutates & returns `data` (a flight booking dict): cleans segments, syncs
    legacy flat fields and recomputes costs/paid from the fare breakdown."""
    if data.get("segments") is not None:
        segs = _clean_segments(data["segments"])
        data["segments"] = segs
        outs = [s for s in segs if s["direction"] == "outbound"]
        rets = [s for s in segs if s["direction"] == "return"]
        if not outs:
            data.update(flight_number=None, depart_airport=None, depart_time=None, arrive_airport=None, arrive_time=None)
        if not rets:
            data.update(return_airline=None, return_confirmation=None, return_flight_number=None,
                        return_depart_airport=None, return_depart_time=None, return_arrive_airport=None,
                        return_arrive_time=None)
        if outs:
            f, l = outs[0], outs[-1]
            data.update(flight_number=f["flight_number"], depart_airport=f["depart_airport"],
                        depart_time=f["depart_time"], arrive_airport=l["arrive_airport"],
                        arrive_time=l["arrive_time"])
            data["provider"] = data.get("provider") or f["airline"]
            data["confirmation"] = data.get("confirmation") or f["confirmation"]
        if rets:
            f, l = rets[0], rets[-1]
            data.update(return_airline=f["airline"], return_confirmation=f["confirmation"],
                        return_flight_number=f["flight_number"], return_depart_airport=f["depart_airport"],
                        return_depart_time=f["depart_time"], return_arrive_airport=l["arrive_airport"],
                        return_arrive_time=l["arrive_time"])
            data["provider"] = data.get("provider") or f["airline"]
    fare = data.get("fare")
    if isinstance(fare, dict) and (_leg_has_values(fare.get("outbound")) or _leg_has_values(fare.get("return"))):
        ob, rt = leg_total(fare.get("outbound")), leg_total(fare.get("return"))
        data["outbound_cost"] = ob if _leg_has_values(fare.get("outbound")) else None
        data["return_cost"] = rt if _leg_has_values(fare.get("return")) else None
        data["cost"] = round(ob + rt, 2)
        data["amount_paid"] = round(_num((fare.get("outbound") or {}).get("amount_paid"))
                                    + _num((fare.get("return") or {}).get("amount_paid")), 2)
    elif data.get("outbound_cost") is not None or data.get("return_cost") is not None:
        total = _num(data.get("outbound_cost")) + _num(data.get("return_cost"))
        if total > 0 and not data.get("cost"):
            data["cost"] = total
    # No top-level date (e.g. only return flights): use the first flight's departure.
    if not data.get("depart_time") and data.get("segments"):
        data["depart_time"] = next((s.get("depart_time") for s in data["segments"] if s.get("depart_time")), None)
    return data


def _fare_of(b: dict) -> dict:
    """Fare breakdown for a booking, deriving one from legacy costs if needed."""
    fare = b.get("fare") if isinstance(b.get("fare"), dict) else None
    if fare and (_leg_has_values(fare.get("outbound")) or _leg_has_values(fare.get("return"))):
        return {"outbound": dict(fare.get("outbound") or {}), "return": dict(fare.get("return") or {})}
    ob, rt, cost, paid = _num(b.get("outbound_cost")), _num(b.get("return_cost")), _num(b.get("cost")), _num(b.get("amount_paid"))
    segs = flight_segments(b)
    only_return = bool(segs) and all(s.get("direction") == "return" for s in segs)
    if not ob and not rt and cost:
        if only_return:
            rt = cost
        else:
            ob = cost
    out = {"outbound": {}, "return": {}}
    if ob:
        out["outbound"] = {"passengers": 1, "base_fare": ob}
    if rt:
        out["return"] = {"passengers": 1, "base_fare": rt}
    if paid:
        out["return" if (only_return or (rt and not ob)) else "outbound"]["amount_paid"] = paid
    return out


def _seg_key(s: dict) -> tuple:
    fn = (s.get("flight_number") or "").replace(" ", "").upper()
    return (fn, str(s.get("depart_time") or "")[:10])


def merge_flight(existing: dict, incoming: dict) -> dict:
    """Drop an imported flight into an existing flight card. Returns the $set
    updates (segments, fare, synced legacy fields, cost, amount_paid)."""
    segs = [dict(s) for s in flight_segments(existing)]
    for s in flight_segments(incoming):
        match = next((e for e in segs if _seg_key(e)[0] and _seg_key(e) == _seg_key(s)), None)
        if match:
            for k in _SEG_FIELDS:
                if not match.get(k) and s.get(k):
                    match[k] = s[k]
            match["passengers"] = list(dict.fromkeys((match.get("passengers") or []) + (s.get("passengers") or [])))
        else:
            segs.append(dict(s))

    fare = _fare_of(existing)
    inc = _fare_of(incoming)
    for d in ("outbound", "return"):
        leg = inc.get(d) or {}
        if _leg_has_values(leg):
            # The imported airfare replaces this direction's fare entirely (so
            # old taxes/bags/seats are never added on top of a flat total);
            # keep the previous payment info only if the import has none.
            new_leg = {k: v for k, v in leg.items() if v not in (None, "")}
            prev = fare.get(d) or {}
            if not _num(new_leg.get("amount_paid")) and _num(prev.get("amount_paid")):
                new_leg["amount_paid"] = prev.get("amount_paid")
                if prev.get("paid_on"):
                    new_leg["paid_on"] = prev["paid_on"]
            fare[d] = new_leg

    data = dict(existing)
    for k in ("provider", "confirmation", "address", "balance_due_date", "notes"):
        if not data.get(k) and incoming.get(k):
            data[k] = incoming[k]
    data["segments"] = segs
    data["fare"] = fare
    apply_flight_rollups(data)
    keys = ("segments", "fare", "provider", "confirmation", "address", "balance_due_date", "notes",
            "cost", "amount_paid", "outbound_cost", "return_cost",
            "flight_number", "depart_airport", "depart_time", "arrive_airport", "arrive_time",
            "return_airline", "return_confirmation", "return_flight_number", "return_depart_airport",
            "return_depart_time", "return_arrive_airport", "return_arrive_time")
    return {k: data.get(k) for k in keys}
