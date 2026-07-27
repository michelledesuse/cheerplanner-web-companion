"""Iter 70 (v2.5) — backend verification for multi-select filters roll-out.

Focus areas:
1. GET /api/calendar items for kind == 'schedule' expose 'event_type'.
2. Custom household event types are surfaced with their chosen color for
   schedule events referencing that type_id.
3. The endpoint continues to return non-schedule kinds (competition, expense_due,
   etc.) that the frontend passes through when the multi-select 'Event types'
   filter is applied on the Calendar tab.

Endpoints touched (all under /api):
  POST /api/auth/login
  GET  /api/calendar
  POST /api/schedule
  DELETE /api/schedule/{id}
  GET/POST/DELETE /api/household/custom-types (event-type)
"""
import os
import uuid
import requests
import pytest


BASE_URL = os.environ.get("EXPO_BACKEND_URL").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# 1) calendar exposes event_type for kind=='schedule'
# ---------------------------------------------------------------------------
class TestCalendarEventTypeField:
    def test_schedule_items_include_event_type(self, h):
        # Create a schedule event we control so we know what to look for.
        title = f"TESTv25_practice_{uuid.uuid4().hex[:6]}"
        date = "2026-02-15"
        payload = {"title": title, "date": date, "event_type": "practice"}
        cr = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=h, timeout=30)
        assert cr.status_code in (200, 201), f"schedule create failed: {cr.status_code} {cr.text}"
        body = cr.json()
        # /api/schedule POST returns the full list of events; find ours by title
        if isinstance(body, list):
            match = [x for x in body if x.get("title") == title]
            assert match, f"created event not present in response list"
            sid = match[0]["id"]
        else:
            sid = body.get("id")
        assert sid

        try:
            r = requests.get(
                f"{BASE_URL}/api/calendar?start={date}&end={date}",
                headers=h,
                timeout=30,
            )
            assert r.status_code == 200
            items = r.json().get("items", [])
            mine = [i for i in items if i.get("title") == title]
            assert mine, f"no schedule item for '{title}' in {[i.get('title') for i in items]}"
            it = mine[0]
            assert it["kind"] == "schedule"
            assert it.get("event_type") == "practice", f"event_type missing/wrong: {it}"
            assert it.get("color") == "#EA580C", f"practice color wrong: {it.get('color')}"
        finally:
            requests.delete(f"{BASE_URL}/api/schedule/{sid}", headers=h, timeout=30)

    def test_non_schedule_items_do_not_require_event_type(self, h):
        # Fetch a large window; assert at least one non-schedule item is
        # present and it does NOT need an event_type.
        r = requests.get(
            f"{BASE_URL}/api/calendar?start=2025-01-01&end=2027-12-31",
            headers=h,
            timeout=60,
        )
        assert r.status_code == 200
        items = r.json().get("items", [])
        non_sched = [i for i in items if i.get("kind") != "schedule"]
        # Seed account has competitions/expenses/etc.; if not, just skip.
        if not non_sched:
            pytest.skip("no non-schedule items on this account; frontend still handles")
        # None of them should have event_type set (it's schedule-specific).
        for i in non_sched[:20]:
            assert "event_type" not in i or i.get("event_type") is None


# ---------------------------------------------------------------------------
# 2) Custom household event type shows on calendar with chosen color
# ---------------------------------------------------------------------------
class TestCustomEventTypeOnCalendar:
    def test_custom_type_event_shows_with_color(self, h):
        # Create a custom event type
        label = f"TESTv25_Camp_{uuid.uuid4().hex[:6]}"
        color = "#123ABC"
        c = requests.post(
            f"{BASE_URL}/api/household/custom-types/event-type",
            json={"label": label, "color": color},
            headers=h,
            timeout=30,
        )
        assert c.status_code in (200, 201), f"custom type create failed: {c.status_code} {c.text}"
        # The endpoint returns the whole household list; find the created id.
        body = c.json()
        types = body.get("event_types") if isinstance(body, dict) else None
        if types is None:
            # Fallback: GET the list
            g = requests.get(f"{BASE_URL}/api/household/custom-types", headers=h, timeout=30)
            assert g.status_code == 200
            types = g.json().get("event_types") or []
        match = [t for t in types if t.get("label") == label]
        assert match, f"custom type not returned: {types}"
        type_id = match[0]["id"]
        assert match[0].get("color") == color

        # Create a schedule event referencing that custom type_id
        title = f"TESTv25_customEvt_{uuid.uuid4().hex[:6]}"
        date = "2026-03-05"
        sr = requests.post(
            f"{BASE_URL}/api/schedule",
            json={"title": title, "date": date, "event_type": type_id},
            headers=h,
            timeout=30,
        )
        assert sr.status_code in (200, 201)
        sbody = sr.json()
        if isinstance(sbody, list):
            match2 = [x for x in sbody if x.get("title") == title]
            assert match2
            sid = match2[0]["id"]
        else:
            sid = sbody.get("id")

        try:
            r = requests.get(
                f"{BASE_URL}/api/calendar?start={date}&end={date}",
                headers=h,
                timeout=30,
            )
            assert r.status_code == 200
            mine = [i for i in r.json().get("items", []) if i.get("title") == title]
            assert mine, "custom-type schedule event not present in /api/calendar"
            it = mine[0]
            assert it["kind"] == "schedule"
            assert it.get("event_type") == type_id
            assert it.get("color") == color, (
                f"expected custom color {color}, got {it.get('color')}"
            )
        finally:
            requests.delete(f"{BASE_URL}/api/schedule/{sid}", headers=h, timeout=30)
            requests.delete(
                f"{BASE_URL}/api/household/custom-types/event-type/{type_id}",
                headers=h,
                timeout=30,
            )
