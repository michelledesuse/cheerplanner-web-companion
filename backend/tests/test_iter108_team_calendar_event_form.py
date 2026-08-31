"""
iter108: Team Calendar upgraded event form
- Backend POST/GET/PATCH/DELETE /api/team/calendar/events with event_type, address,
  start_time, end_time, recurrence {freq, interval, byweekday, until}.
- Verifies DAILY expansion (consecutive days) and BI-WEEKLY (weekly interval=2)
  expansion every 14 days.
- Verifies RSVP flow (staff GET rsvps + viewer POST rsvp for their athlete).
"""
import os
import re
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
if not BASE_URL:
    # Fallback to /app/frontend/.env
    try:
        with open("/app/frontend/.env", "r") as f:
            m = re.search(r"^EXPO_PUBLIC_BACKEND_URL=(.+)$", f.read(), re.M)
            if m:
                BASE_URL = m.group(1).strip()
    except Exception:
        pass
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
BASE_URL = BASE_URL.rstrip("/")

COACH = ("coach.casey@cheerplanner.app", "CheerDemo2026!")
PARENT = ("parent.taylor@cheerplanner.app", "CheerDemo2026!")
ATHLETE = ("sophia.athlete@cheerplanner.app", "CheerDemo2026!")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def coach_h():
    return {"Authorization": f"Bearer {_login(*COACH)}"}


@pytest.fixture(scope="module")
def parent_h():
    return {"Authorization": f"Bearer {_login(*PARENT)}"}


@pytest.fixture(scope="module")
def athlete_h():
    return {"Authorization": f"Bearer {_login(*ATHLETE)}"}


CREATED_IDS = []


@pytest.fixture(scope="module", autouse=True)
def cleanup(coach_h):
    yield
    for eid in CREATED_IDS:
        try:
            requests.delete(f"{BASE_URL}/api/team/calendar/events/{eid}", headers=coach_h, timeout=20)
        except Exception:
            pass


# --- 1) Create event with new fields ---------------------------------------
def test_create_event_with_all_fields(coach_h):
    start = (date.today() + timedelta(days=2)).isoformat()
    until = (date.today() + timedelta(days=90)).isoformat()
    payload = {
        "title": "TEST_iter108 Weekly Practice",
        "event_type": "practice",
        "location": "TEST Gym",
        "address": "123 TEST St",
        "date": start,
        "start_time": "17:30",
        "end_time": "19:00",
        "notes": "TEST notes",
        "recurrence": {"freq": "weekly", "interval": 1, "byweekday": [date.fromisoformat(start).weekday()], "until": until},
    }
    r = requests.post(f"{BASE_URL}/api/team/calendar/events", json=payload, headers=coach_h, timeout=20)
    assert r.status_code == 200, r.text
    ev = r.json()
    assert ev["title"] == payload["title"]
    assert ev["event_type"] == "practice"
    assert ev["address"] == "123 TEST St"
    assert ev["start_time"] == "17:30"
    assert ev["end_time"] == "19:00"
    assert ev["recurrence"]["freq"] == "weekly"
    CREATED_IDS.append(ev["id"])


# --- 2) List returns rows including new fields, and expands recurrences ----
def test_list_daily_expansion(coach_h):
    start = (date.today() + timedelta(days=1)).isoformat()
    until = (date.today() + timedelta(days=5)).isoformat()
    payload = {
        "title": "TEST_iter108 Daily",
        "event_type": "team_bonding",
        "date": start,
        "start_time": "10:00",
        "end_time": "11:00",
        "recurrence": {"freq": "daily", "interval": 1, "until": until},
    }
    r = requests.post(f"{BASE_URL}/api/team/calendar/events", json=payload, headers=coach_h, timeout=20)
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    CREATED_IDS.append(eid)

    from_d = date.today().isoformat()
    r2 = requests.get(f"{BASE_URL}/api/team/calendar/events?from_={from_d}", headers=coach_h, timeout=20)
    assert r2.status_code == 200
    rows = [row for row in r2.json()["events"] if row["event_id"] == eid]
    dates = sorted({row["occ_date"] for row in rows})
    # Consecutive daily from start..until inclusive = 5 days
    expected = [(date.fromisoformat(start) + timedelta(days=i)).isoformat() for i in range(5)]
    assert dates == expected, f"daily expansion mismatch: {dates} vs {expected}"
    # Verify new fields present
    row = rows[0]
    for k in ("event_type", "address", "start_time", "end_time", "recurrence", "event_date", "occ_date"):
        assert k in row, f"missing field {k}"
    assert row["event_type"] == "team_bonding"
    assert row["event_date"] == start


def test_list_biweekly_expansion(coach_h):
    start = (date.today() + timedelta(days=1)).isoformat()
    until = (date.today() + timedelta(days=60)).isoformat()  # ~2 months window
    wd = date.fromisoformat(start).weekday()
    payload = {
        "title": "TEST_iter108 Biweekly",
        "event_type": "practice",
        "date": start,
        "recurrence": {"freq": "weekly", "interval": 2, "byweekday": [wd], "until": until},
    }
    r = requests.post(f"{BASE_URL}/api/team/calendar/events", json=payload, headers=coach_h, timeout=20)
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    CREATED_IDS.append(eid)

    from_d = date.today().isoformat()
    to_d = until
    r2 = requests.get(f"{BASE_URL}/api/team/calendar/events?from_={from_d}&to={to_d}", headers=coach_h, timeout=20)
    rows = [row for row in r2.json()["events"] if row["event_id"] == eid]
    dates = sorted({row["occ_date"] for row in rows})
    # Every 14 days consecutive gaps
    assert len(dates) >= 2, f"expected at least 2 biweekly occurrences, got {dates}"
    diffs = [(date.fromisoformat(dates[i + 1]) - date.fromisoformat(dates[i])).days for i in range(len(dates) - 1)]
    assert all(d == 14 for d in diffs), f"biweekly gaps not 14 days: {diffs}"


# --- 3) PATCH updates fields including recurrence --------------------------
def test_patch_event(coach_h):
    start = (date.today() + timedelta(days=3)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/team/calendar/events",
        json={"title": "TEST_iter108 Edit Me", "date": start, "event_type": "class"},
        headers=coach_h, timeout=20,
    )
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    CREATED_IDS.append(eid)

    upd = {
        "title": "TEST_iter108 Edited",
        "event_type": "competition",
        "address": "999 Update Blvd",
        "location": "New Arena",
        "start_time": "08:00",
        "end_time": "10:00",
        "notes": "updated",
        "recurrence": {"freq": "daily", "interval": 1, "until": (date.fromisoformat(start) + timedelta(days=3)).isoformat()},
    }
    r2 = requests.patch(f"{BASE_URL}/api/team/calendar/events/{eid}", json=upd, headers=coach_h, timeout=20)
    assert r2.status_code == 200, r2.text
    # Verify via GET
    r3 = requests.get(f"{BASE_URL}/api/team/calendar/events?from_={date.today().isoformat()}", headers=coach_h, timeout=20)
    rows = [row for row in r3.json()["events"] if row["event_id"] == eid]
    assert rows, "event disappeared after patch"
    row = rows[0]
    assert row["title"] == "TEST_iter108 Edited"
    assert row["event_type"] == "competition"
    assert row["address"] == "999 Update Blvd"
    assert row["location"] == "New Arena"
    assert row["start_time"] == "08:00"
    assert row["notes"] == "updated"
    assert row["recurrence"]["freq"] == "daily"


# --- 4) DELETE removes event + rsvps ---------------------------------------
def test_delete_event(coach_h):
    start = (date.today() + timedelta(days=1)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/team/calendar/events",
        json={"title": "TEST_iter108 ToDelete", "date": start},
        headers=coach_h, timeout=20,
    )
    assert r.status_code == 200
    eid = r.json()["id"]

    r2 = requests.delete(f"{BASE_URL}/api/team/calendar/events/{eid}", headers=coach_h, timeout=20)
    assert r2.status_code == 200

    r3 = requests.get(f"{BASE_URL}/api/team/calendar/events?from_={date.today().isoformat()}", headers=coach_h, timeout=20)
    ids = {row["event_id"] for row in r3.json()["events"]}
    assert eid not in ids


# --- 5) RSVP flow ----------------------------------------------------------
def test_rsvp_flow(coach_h, parent_h):
    # Create an event tomorrow
    start = (date.today() + timedelta(days=1)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/team/calendar/events",
        json={"title": "TEST_iter108 RSVP", "date": start, "event_type": "practice"},
        headers=coach_h, timeout=20,
    )
    assert r.status_code == 200
    eid = r.json()["id"]
    CREATED_IDS.append(eid)

    # Parent lists events → should include the occ + athletes list
    r2 = requests.get(f"{BASE_URL}/api/team/calendar/events?from_={date.today().isoformat()}", headers=parent_h, timeout=20)
    assert r2.status_code == 200
    body = r2.json()
    assert body["role"] == "viewer"
    ath = body.get("athletes") or []
    if not ath:
        pytest.skip("parent has no linked athletes in demo data")
    roster_id = ath[0]["roster_id"]

    # RSVP Attending
    r3 = requests.post(
        f"{BASE_URL}/api/team/calendar/rsvp",
        json={"event_id": eid, "occ_date": start, "roster_id": roster_id, "status": "attending"},
        headers=parent_h, timeout=20,
    )
    assert r3.status_code == 200, r3.text

    # Staff lists rsvps
    r4 = requests.get(
        f"{BASE_URL}/api/team/calendar/rsvps?event_id={eid}&occ_date={start}",
        headers=coach_h, timeout=20,
    )
    assert r4.status_code == 200
    data = r4.json()
    assert data["attending"] >= 1
    assert any(rv["roster_id"] == roster_id and rv["status"] == "attending" for rv in data["rsvps"])

    # Not attending requires reason
    r5 = requests.post(
        f"{BASE_URL}/api/team/calendar/rsvp",
        json={"event_id": eid, "occ_date": start, "roster_id": roster_id, "status": "not_attending"},
        headers=parent_h, timeout=20,
    )
    assert r5.status_code == 400

    r6 = requests.post(
        f"{BASE_URL}/api/team/calendar/rsvp",
        json={"event_id": eid, "occ_date": start, "roster_id": roster_id, "status": "not_attending", "reason": "sick"},
        headers=parent_h, timeout=20,
    )
    assert r6.status_code == 200


# --- 6) Validations --------------------------------------------------------
def test_create_requires_title_and_date(coach_h):
    r = requests.post(f"{BASE_URL}/api/team/calendar/events", json={"date": date.today().isoformat()}, headers=coach_h, timeout=20)
    assert r.status_code == 400
    r2 = requests.post(f"{BASE_URL}/api/team/calendar/events", json={"title": "no date"}, headers=coach_h, timeout=20)
    assert r2.status_code == 400
