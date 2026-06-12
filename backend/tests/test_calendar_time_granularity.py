"""Backend tests for CheerPlanner calendar time-granularity feature.

Covers acceptance criteria from review request:
  - Competition.event_time create/update/clear (HH:MM 24h)
  - Booking (hotel).check_in_time / check_out_time create/update
  - GET /api/calendar — competition/hotel/flight items expose `time` field
    (and `end_time` for flights) plus 12-hour-formatted subtitles
  - GET /api/calendar — fallback to all-day when times are absent
  - GET /api/export/calendar.ics — emits timed VEVENTs with DTSTART/DTEND
    when item.time is set; all-day DTSTART;VALUE=DATE otherwise
  - GET /api/reminders — still works, no regressions from new fields
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://spirit-finance-2.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


# ---------- helpers ----------
def _signup():
    email = f"TEST_caltime_{uuid.uuid4().hex[:10]}@mailinator.com"
    r = requests.post(
        f"{API}/auth/signup",
        json={"email": email, "password": "Password123!", "name": "CalTime Tester"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"], email


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _iso(days_offset: int) -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=days_offset)).isoformat()


def _create_comp(token: str, ev: str, **extra) -> dict:
    body = {"name": f"TEST_Comp_{uuid.uuid4().hex[:6]}", "event_date": ev, **extra}
    r = requests.post(f"{API}/competitions", headers=_auth(token), json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _create_booking(token: str, **body) -> dict:
    r = requests.post(f"{API}/bookings", headers=_auth(token), json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def user():
    token, email = _signup()
    return {"token": token, "email": email}


# ============================================================
# 1. Competition event_time create / update / clear
# ============================================================
class TestCompetitionEventTime:
    def test_create_with_event_time_persists(self, user):
        ev = _iso(7)
        comp = _create_comp(user["token"], ev, event_time="14:30", location="Hall A")
        assert comp.get("event_time") == "14:30"

        # GET to verify persistence
        r = requests.get(f"{API}/competitions", headers=_auth(user["token"]), timeout=30)
        assert r.status_code == 200
        match = next((c for c in r.json() if c["id"] == comp["id"]), None)
        assert match is not None
        assert match["event_time"] == "14:30"

    def test_create_without_event_time_is_none(self, user):
        comp = _create_comp(user["token"], _iso(8))
        assert comp.get("event_time") in (None, "")

    def test_patch_set_event_time(self, user):
        comp = _create_comp(user["token"], _iso(9))
        r = requests.patch(
            f"{API}/competitions/{comp['id']}",
            headers=_auth(user["token"]),
            json={"event_time": "09:15"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("event_time") == "09:15"

    def test_patch_clear_event_time_via_empty_string(self, user):
        comp = _create_comp(user["token"], _iso(10), event_time="11:00")
        assert comp["event_time"] == "11:00"
        # Backend update_competition() strips None from update payload,
        # so the documented way to clear is to send an empty string.
        r = requests.patch(
            f"{API}/competitions/{comp['id']}",
            headers=_auth(user["token"]),
            json={"event_time": ""},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # Verify via fresh GET
        r2 = requests.get(f"{API}/competitions", headers=_auth(user["token"]), timeout=30)
        match = next(c for c in r2.json() if c["id"] == comp["id"])
        assert match["event_time"] in (None, "")


# ============================================================
# 2. Booking hotel check_in_time / check_out_time
# ============================================================
class TestBookingHotelTimes:
    def test_create_hotel_with_times(self, user):
        comp = _create_comp(user["token"], _iso(15))
        ci = _iso(14)
        co = _iso(16)
        b = _create_booking(
            user["token"],
            type="hotel",
            competition_id=comp["id"],
            provider="TEST_Hilton",
            check_in=ci,
            check_in_time="15:00",
            check_out=co,
            check_out_time="11:00",
        )
        assert b["check_in_time"] == "15:00"
        assert b["check_out_time"] == "11:00"

    def test_patch_hotel_times(self, user):
        comp = _create_comp(user["token"], _iso(20))
        ci = _iso(19)
        co = _iso(21)
        b = _create_booking(
            user["token"],
            type="hotel",
            competition_id=comp["id"],
            provider="TEST_Marriott",
            check_in=ci,
            check_out=co,
        )
        assert b.get("check_in_time") in (None, "")
        r = requests.patch(
            f"{API}/bookings/{b['id']}",
            headers=_auth(user["token"]),
            json={"check_in_time": "16:30", "check_out_time": "10:45"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["check_in_time"] == "16:30"
        assert body["check_out_time"] == "10:45"


# ============================================================
# 3. /api/calendar — competition event_time exposure
# ============================================================
class TestCalendarFeedCompetitionTime:
    def test_competition_with_event_time(self, user):
        ev = _iso(30)
        comp = _create_comp(user["token"], ev, event_time="14:30", location="Arena")
        start = _iso(28)
        end = _iso(32)
        r = requests.get(
            f"{API}/calendar",
            params={"start": start, "end": end},
            headers=_auth(user["token"]),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        # Find the matching comp item on the event date
        item = next(
            (i for i in items if i.get("kind") == "competition" and comp["id"] in i.get("id", "") and i.get("date") == ev),
            None,
        )
        assert item is not None, f"No comp item found for {comp['id']} on {ev}"
        assert item.get("time") == "14:30"
        # Subtitle should contain 12h string "2:30 PM"
        assert "2:30 PM" in item.get("subtitle", ""), f"subtitle missing 12h time: {item.get('subtitle')!r}"

    def test_competition_without_event_time_is_all_day(self, user):
        ev = _iso(40)
        comp = _create_comp(user["token"], ev, location="No-Time-Arena")
        start = _iso(38)
        end = _iso(42)
        r = requests.get(
            f"{API}/calendar",
            params={"start": start, "end": end},
            headers=_auth(user["token"]),
            timeout=30,
        )
        items = r.json()["items"]
        item = next(i for i in items if i.get("kind") == "competition" and comp["id"] in i.get("id", ""))
        # time field absent OR null
        assert item.get("time") in (None,), f"expected null time, got {item.get('time')!r}"
        # subtitle should not include AM/PM string
        assert "AM" not in item.get("subtitle", "") and "PM" not in item.get("subtitle", "")


# ============================================================
# 4. /api/calendar — hotel check-in / check-out
# ============================================================
class TestCalendarFeedHotelTimes:
    def test_hotel_checkin_checkout_subtitle_and_time(self, user):
        comp = _create_comp(user["token"], _iso(50))
        ci = _iso(48)
        co = _iso(51)
        _create_booking(
            user["token"],
            type="hotel",
            competition_id=comp["id"],
            provider="TEST_Westin",
            check_in=ci,
            check_in_time="15:00",
            check_out=co,
            check_out_time="11:00",
        )
        r = requests.get(
            f"{API}/calendar",
            params={"start": _iso(47), "end": _iso(52)},
            headers=_auth(user["token"]),
            timeout=30,
        )
        items = r.json()["items"]
        checkin = next(i for i in items if i.get("kind") == "hotel_checkin" and i.get("date") == ci)
        checkout = next(i for i in items if i.get("kind") == "hotel_checkout" and i.get("date") == co)
        assert checkin.get("time") == "15:00"
        assert "Check-in 3:00 PM" in checkin.get("subtitle", ""), f"checkin sub: {checkin.get('subtitle')!r}"
        assert checkout.get("time") == "11:00"
        assert "Check-out 11:00 AM" in checkout.get("subtitle", ""), f"checkout sub: {checkout.get('subtitle')!r}"

    def test_hotel_without_times_is_all_day(self, user):
        comp = _create_comp(user["token"], _iso(60))
        ci = _iso(58)
        co = _iso(61)
        _create_booking(
            user["token"],
            type="hotel",
            competition_id=comp["id"],
            provider="TEST_NoTimes",
            check_in=ci,
            check_out=co,
        )
        r = requests.get(
            f"{API}/calendar",
            params={"start": _iso(57), "end": _iso(62)},
            headers=_auth(user["token"]),
            timeout=30,
        )
        items = r.json()["items"]
        checkin = next(i for i in items if i.get("kind") == "hotel_checkin" and i.get("date") == ci)
        checkout = next(i for i in items if i.get("kind") == "hotel_checkout" and i.get("date") == co)
        assert checkin.get("time") in (None,), f"expected null, got {checkin.get('time')!r}"
        assert checkout.get("time") in (None,)
        assert "AM" not in checkin.get("subtitle", "") and "PM" not in checkin.get("subtitle", "")


# ============================================================
# 5. /api/calendar — flight legs expose times in subtitle
# ============================================================
class TestCalendarFeedFlightTimes:
    def test_flight_depart_return_times(self, user):
        comp = _create_comp(user["token"], _iso(70))
        dep_date = _iso(68)
        ret_date = _iso(72)
        _create_booking(
            user["token"],
            type="flight",
            competition_id=comp["id"],
            provider="TEST_Delta",
            flight_number="DL100",
            depart_airport="JFK",
            arrive_airport="LAX",
            depart_time=f"{dep_date} 08:30",
            arrive_time=f"{dep_date} 11:45",
            return_flight_number="DL200",
            return_depart_airport="LAX",
            return_arrive_airport="JFK",
            return_depart_time=f"{ret_date} 17:15",
            return_arrive_time=f"{ret_date} 23:55",
        )
        r = requests.get(
            f"{API}/calendar",
            params={"start": _iso(67), "end": _iso(73)},
            headers=_auth(user["token"]),
            timeout=30,
        )
        items = r.json()["items"]
        dep = next(i for i in items if i.get("kind") == "flight_depart" and i.get("date") == dep_date)
        ret = next(i for i in items if i.get("kind") == "flight_return" and i.get("date") == ret_date)
        assert dep.get("time") == "08:30"
        assert dep.get("end_time") == "11:45"
        assert "Depart 8:30 AM" in dep.get("subtitle", ""), f"dep sub: {dep.get('subtitle')!r}"
        assert ret.get("time") == "17:15"
        assert ret.get("end_time") == "23:55"
        assert "Depart 5:15 PM" in ret.get("subtitle", ""), f"ret sub: {ret.get('subtitle')!r}"

    def test_flight_without_times_no_time_field(self, user):
        comp = _create_comp(user["token"], _iso(80))
        dep_date = _iso(78)
        _create_booking(
            user["token"],
            type="flight",
            competition_id=comp["id"],
            provider="TEST_United",
            flight_number="UA1",
            depart_airport="ORD",
            arrive_airport="MIA",
            depart_time=dep_date,  # date only, no time
        )
        r = requests.get(
            f"{API}/calendar",
            params={"start": _iso(77), "end": _iso(82)},
            headers=_auth(user["token"]),
            timeout=30,
        )
        items = r.json()["items"]
        dep = next(
            (i for i in items if i.get("kind") == "flight_depart" and i.get("date") == dep_date),
            None,
        )
        assert dep is not None
        # No HH:MM was provided, so time should be null
        assert dep.get("time") in (None,), f"expected null, got {dep.get('time')!r}"


# ============================================================
# 6. /api/export/calendar.ics — timed vs all-day VEVENTs
# ============================================================
class TestICSExport:
    def _fetch_ics(self, token: str) -> str:
        r = requests.get(f"{API}/export/calendar.ics", headers=_auth(token), timeout=30)
        assert r.status_code == 200, r.text
        return r.text

    def test_comp_with_event_time_emits_timed_vevent(self, user):
        ev = _iso(90)
        comp = _create_comp(user["token"], ev, event_time="14:30", location="ICS Arena")
        ics = self._fetch_ics(user["token"])
        ymd = ev.replace("-", "")
        # Find the VEVENT block matching this comp
        # Each block is delimited by BEGIN:VEVENT ... END:VEVENT
        blocks = ics.split("BEGIN:VEVENT")
        block = next(
            (b for b in blocks if f"comp-{comp['id']}-{ev}" in b),
            None,
        )
        assert block is not None, f"VEVENT for comp {comp['id']} not found in ICS"
        # Expect timed DTSTART
        assert f"DTSTART:{ymd}T143000" in block, f"missing DTSTART in block: {block[:400]!r}"
        # DTEND should be 1h later (15:30)
        assert f"DTEND:{ymd}T153000" in block, f"missing DTEND in block: {block[:400]!r}"

    def test_comp_without_event_time_emits_all_day(self, user):
        ev = _iso(95)
        comp = _create_comp(user["token"], ev, location="AllDay Arena")
        ics = self._fetch_ics(user["token"])
        ymd = ev.replace("-", "")
        blocks = ics.split("BEGIN:VEVENT")
        block = next((b for b in blocks if f"comp-{comp['id']}-{ev}" in b), None)
        assert block is not None
        assert f"DTSTART;VALUE=DATE:{ymd}" in block, f"expected all-day DTSTART in block: {block[:400]!r}"
        # Should NOT have a timed DTSTART for this comp
        assert f"DTSTART:{ymd}T" not in block

    def test_hotel_with_times_emits_timed_vevents(self, user):
        comp = _create_comp(user["token"], _iso(100))
        ci = _iso(98)
        co = _iso(101)
        b = _create_booking(
            user["token"],
            type="hotel",
            competition_id=comp["id"],
            provider="TEST_ICS_Hotel",
            check_in=ci,
            check_in_time="15:00",
            check_out=co,
            check_out_time="11:00",
        )
        ics = self._fetch_ics(user["token"])
        blocks = ics.split("BEGIN:VEVENT")
        ci_ymd = ci.replace("-", "")
        co_ymd = co.replace("-", "")
        ci_block = next((bl for bl in blocks if f"hotel-{b['id']}-{ci}" in bl), None)
        co_block = next((bl for bl in blocks if f"hotel-{b['id']}-{co}" in bl), None)
        assert ci_block is not None and co_block is not None
        assert f"DTSTART:{ci_ymd}T150000" in ci_block
        assert f"DTEND:{ci_ymd}T160000" in ci_block  # +1h default
        assert f"DTSTART:{co_ymd}T110000" in co_block
        assert f"DTEND:{co_ymd}T120000" in co_block  # +1h default

    def test_flight_with_times_emits_timed_vevents(self, user):
        comp = _create_comp(user["token"], _iso(110))
        dep_date = _iso(108)
        ret_date = _iso(112)
        b = _create_booking(
            user["token"],
            type="flight",
            competition_id=comp["id"],
            provider="TEST_ICS_Air",
            flight_number="IA1",
            depart_airport="JFK",
            arrive_airport="LAX",
            depart_time=f"{dep_date} 08:30",
            arrive_time=f"{dep_date} 11:45",
            return_depart_time=f"{ret_date} 17:15",
            return_arrive_time=f"{ret_date} 23:55",
            return_depart_airport="LAX",
            return_arrive_airport="JFK",
        )
        ics = self._fetch_ics(user["token"])
        blocks = ics.split("BEGIN:VEVENT")
        dep_block = next((bl for bl in blocks if f"flight-dep-{b['id']}" in bl), None)
        ret_block = next((bl for bl in blocks if f"flight-ret-{b['id']}" in bl), None)
        assert dep_block is not None and ret_block is not None
        dep_ymd = dep_date.replace("-", "")
        ret_ymd = ret_date.replace("-", "")
        # depart_time -> DTSTART, arrive_time -> DTEND
        assert f"DTSTART:{dep_ymd}T083000" in dep_block
        assert f"DTEND:{dep_ymd}T114500" in dep_block
        assert f"DTSTART:{ret_ymd}T171500" in ret_block
        assert f"DTEND:{ret_ymd}T235500" in ret_block


# ============================================================
# 7. /api/reminders regression — still works
# ============================================================
class TestRemindersRegression:
    def test_reminders_endpoint_still_returns_list(self, user):
        # Create a comp with event_time + a hotel with check_in_time within the
        # reminder window to ensure parse_date() handles the new fields cleanly.
        comp = _create_comp(user["token"], _iso(3), event_time="09:00", location="Reminder Arena")
        _create_booking(
            user["token"],
            type="hotel",
            competition_id=comp["id"],
            provider="TEST_ReminderHotel",
            check_in=_iso(2),
            check_in_time="15:00",
            check_out=_iso(4),
            check_out_time="11:00",
        )
        r = requests.get(f"{API}/reminders", headers=_auth(user["token"]), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # /api/reminders may return list or dict; just confirm it's truthy and parses
        assert body is not None
        assert isinstance(body, (list, dict))
