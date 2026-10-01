"""Iter142: recurring import between personal and team calendars.

Verifies the full backend flow described in the review request:
  - A weekly recurring personal schedule series can be imported into the
    Team Hub as ONE recurring team_event (dedupe by series_id).
  - GET /api/team/calendar/events returns many expanded occurrences, all
    marked recurring:true, with correct start/end times and recurrence rule.
  - After importing, the importable list marks all occurrences already=true.
  - import-to-personal re-creates a recurring personal series.
  - All QA_IT142 rows are cleaned up afterward.
"""
import os
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ["EXPO_BACKEND_URL"]
BASE_URL = BASE_URL.rstrip("/")

OWNER_EMAIL = "demo@cheerplanner.app"
OWNER_PWD = "CheerDemo2026!"

PREFIX = "QA_IT142 Practice"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PWD)


@pytest.fixture(scope="module")
def owner_h(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


# A future Monday (Mon = Python 0, JS 1)
def _next_monday_in_november_2026() -> str:
    return "2026-11-02"  # 2026-11-02 is a Monday


@pytest.fixture(scope="module")
def created_series(owner_h):
    payload = {
        "title": PREFIX,
        "event_type": "practice",
        "date": _next_monday_in_november_2026(),
        "start_time": "18:00",
        "end_time": "20:00",
        "recurrence_rule": {
            "frequency": "weekly",
            # Sun=0..Sat=6: Monday=1, Wednesday=3
            "days_of_week": [1, 3],
            "until": "2026-12-20",
        },
    }
    r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=owner_h, timeout=30)
    assert r.status_code in (200, 201), f"schedule create failed: {r.status_code} {r.text}"
    data = r.json()
    # Response may be a list of occurrences or an object with occurrences.
    occ = data if isinstance(data, list) else (data.get("events") or data.get("occurrences") or [])
    assert isinstance(occ, list) and len(occ) >= 4, f"expected many occurrences, got: {data}"
    series_ids = {o.get("series_id") for o in occ if o.get("series_id")}
    assert len(series_ids) == 1, f"all occurrences should share one series_id, got {series_ids}"
    occ_ids = [o["id"] for o in occ]
    return {"occ": occ, "series_id": next(iter(series_ids)), "ids": occ_ids}


def test_importable_lists_series_occurrences_not_already(owner_h, created_series):
    r = requests.get(f"{BASE_URL}/api/team/calendar/importable", headers=owner_h, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    sid = created_series["series_id"]
    events = [e for e in body.get("events") or [] if e.get("series_id") == sid]
    assert len(events) >= 4, f"expected multiple occurrences for series, got {len(events)}"
    assert all(e.get("already") is False for e in events), "none should be already imported yet"


def test_bulk_import_dedupes_series_into_one_team_event(owner_h, created_series):
    items = [{"source": "schedule", "id": i} for i in created_series["ids"]]
    r = requests.post(
        f"{BASE_URL}/api/team/calendar/import-from-personal-bulk",
        json={"items": items, "include": {}},
        headers=owner_h,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("imported") == 1, f"expected imported=1 got {body}"
    expected_already = len(items) - 1
    assert body.get("already") == expected_already, f"expected already={expected_already}, got {body}"


def test_team_calendar_events_shows_expanded_recurring(owner_h, created_series):
    r = requests.get(
        f"{BASE_URL}/api/team/calendar/events",
        params={"from_": "2026-10-01", "to": "2027-01-15"},
        headers=owner_h,
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    events = [e for e in body.get("events") or [] if e.get("title") == PREFIX]
    assert len(events) >= 4, f"expected many expanded occurrences, got {len(events)}"
    event_ids = {e["event_id"] for e in events}
    assert len(event_ids) == 1, f"should all share ONE team event id, got {event_ids}"
    for e in events:
        assert e.get("recurring") is True, f"row not marked recurring: {e}"
        assert e.get("start_time") == "18:00", f"bad start_time: {e}"
        assert e.get("end_time") == "20:00", f"bad end_time: {e}"
        rec = e.get("recurrence") or {}
        assert rec.get("freq") == "weekly"
        assert int(rec.get("interval") or 1) == 1
        assert set(rec.get("byweekday") or []) == {1, 3}
        assert str(rec.get("until") or "")[:10] == "2026-12-20"


def test_importable_now_marks_all_already(owner_h, created_series):
    r = requests.get(f"{BASE_URL}/api/team/calendar/importable", headers=owner_h, timeout=20)
    assert r.status_code == 200
    sid = created_series["series_id"]
    events = [e for e in r.json().get("events") or [] if e.get("series_id") == sid]
    assert len(events) >= 4
    assert all(e.get("already") is True for e in events), "all occurrences should now be already=True"


def test_import_to_personal_recreates_recurring_series(owner_h, created_series):
    # Find the team event id for our imported series via list events
    r = requests.get(
        f"{BASE_URL}/api/team/calendar/events",
        params={"from_": "2026-10-01", "to": "2027-01-15"},
        headers=owner_h,
        timeout=20,
    )
    rows = [e for e in r.json().get("events") or [] if e.get("title") == PREFIX]
    assert rows, "need a team event to import to personal"
    team_event_id = rows[0]["event_id"]

    # First remove the existing personal series so we can test re-import.
    # The owner is the ONLY user and currently has the original series. Delete it.
    sched_resp = requests.get(f"{BASE_URL}/api/schedule", headers=owner_h, timeout=20)
    assert sched_resp.status_code == 200
    sched = sched_resp.json()
    mine = [s for s in sched if s.get("title") == PREFIX]
    for s in mine:
        requests.delete(f"{BASE_URL}/api/schedule/{s['id']}", headers=owner_h, timeout=20)

    r = requests.post(
        f"{BASE_URL}/api/team/calendar/import-to-personal",
        json={"event_id": team_event_id},
        headers=owner_h,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("created", 0) >= 4, f"expected multiple personal rows created, got {body}"

    # Verify they share one series_id and have weekly recurrence_rule 18-20.
    sched = requests.get(f"{BASE_URL}/api/schedule", headers=owner_h, timeout=20).json()
    mine = [s for s in sched if s.get("title") == PREFIX]
    assert len(mine) >= 4
    sids = {s.get("series_id") for s in mine}
    assert len(sids) == 1 and None not in sids, f"series_id should be shared, got {sids}"
    for s in mine:
        assert s.get("start_time") == "18:00"
        assert s.get("end_time") == "20:00"
        rr = s.get("recurrence_rule") or {}
        assert rr.get("frequency") in ("weekly",)
        assert set(rr.get("days_of_week") or []) == {1, 3}


def test_cleanup_qa_it142(owner_h):
    """Remove every QA_IT142 schedule_event and team_event we may have created."""
    # Delete personal schedule rows
    sched = requests.get(f"{BASE_URL}/api/schedule", headers=owner_h, timeout=20).json()
    for s in sched:
        if s.get("title") == PREFIX:
            requests.delete(f"{BASE_URL}/api/schedule/{s['id']}", headers=owner_h, timeout=20)
    sched = requests.get(f"{BASE_URL}/api/schedule", headers=owner_h, timeout=20).json()
    assert not [s for s in sched if s.get("title") == PREFIX], "schedule rows not fully cleaned"

    # Delete team events
    r = requests.get(
        f"{BASE_URL}/api/team/calendar/events",
        params={"from_": "2026-10-01", "to": "2027-01-15"},
        headers=owner_h,
        timeout=20,
    )
    seen_ids = {e["event_id"] for e in r.json().get("events") or [] if e.get("title") == PREFIX}
    for eid in seen_ids:
        requests.delete(f"{BASE_URL}/api/team/calendar/events/{eid}", headers=owner_h, timeout=20)
    r = requests.get(
        f"{BASE_URL}/api/team/calendar/events",
        params={"from_": "2026-10-01", "to": "2027-01-15"},
        headers=owner_h,
        timeout=20,
    )
    remaining = [e for e in r.json().get("events") or [] if e.get("title") == PREFIX]
    assert not remaining, f"team events not fully cleaned: {remaining}"
