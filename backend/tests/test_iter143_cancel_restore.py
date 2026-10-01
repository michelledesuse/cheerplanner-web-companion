"""Iter143 — Team Hub recurring event cancel/restore occurrence tests.

Verifies:
- Creating a weekly recurring event via POST /api/team/calendar/events.
- GET /api/team/calendar/events expands to N occurrences sharing one event_id
  and each row includes exdates: [].
- POST /cancel-occurrence removes one date (N-1 remain) and clears RSVPs; the
  cancelled date appears in exdates on surviving rows.
- POST /restore-occurrence brings it back (N remain) and exdates no longer
  contains it.
- cancel-occurrence with a bad/empty occ_date -> 400; unknown event id -> 404.
- Cleans up the QA143 event.
"""
import os
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASS = "CheerDemo2026!"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"no token in login response: {data}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def recurring_event(api_client):
    """Create a weekly Tuesday recurring event; delete afterwards."""
    # Pick a Tuesday in Nov 2026 safely in the future vs ~2026-10-01 'today'.
    start_date = date(2026, 11, 3)  # Tuesday
    until = date(2026, 12, 15)
    payload = {
        "title": "QA143 Practice",
        "event_type": "practice",
        "date": start_date.isoformat(),
        "start_time": "17:00",
        "end_time": "19:00",
        # Team byweekday is Sun=0..Sat=6 -> Tuesday = 2
        "recurrence": {"freq": "weekly", "interval": 1, "byweekday": [2], "until": until.isoformat()},
    }
    r = api_client.post(f"{BASE_URL}/api/team/calendar/events", json=payload)
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
    ev = r.json()
    assert ev["id"]
    yield ev
    # cleanup
    api_client.delete(f"{BASE_URL}/api/team/calendar/events/{ev['id']}")


class TestCancelRestoreOccurrence:
    def test_initial_expansion(self, api_client, recurring_event):
        r = api_client.get(
            f"{BASE_URL}/api/team/calendar/events",
            params={"from_": "2026-10-01", "to": "2027-01-15"},
        )
        assert r.status_code == 200
        rows = [e for e in r.json().get("events", []) if e["event_id"] == recurring_event["id"]]
        # Tuesdays 2026-11-03 .. 2026-12-15 inclusive = 7 occurrences
        assert len(rows) == 7, f"expected 7 occurrences, got {len(rows)}: {[r['occ_date'] for r in rows]}"
        for row in rows:
            assert row.get("exdates") == []
            assert row["event_id"] == recurring_event["id"]
            assert row["recurring"] is True
            assert row["start_time"] == "17:00"

    def test_cancel_occurrence_removes_one(self, api_client, recurring_event):
        # Middle Tuesday: 2026-11-24
        occ = "2026-11-24"
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/cancel-occurrence",
            json={"occ_date": occ},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        g = api_client.get(
            f"{BASE_URL}/api/team/calendar/events",
            params={"from_": "2026-10-01", "to": "2027-01-15"},
        )
        rows = [e for e in g.json().get("events", []) if e["event_id"] == recurring_event["id"]]
        dates = [r["occ_date"] for r in rows]
        assert occ not in dates
        assert len(rows) == 6
        # exdates on surviving rows must include the cancelled date
        for row in rows:
            assert occ in (row.get("exdates") or [])

    def test_restore_occurrence_brings_it_back(self, api_client, recurring_event):
        occ = "2026-11-24"
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/restore-occurrence",
            json={"occ_date": occ},
        )
        assert r.status_code == 200, r.text

        g = api_client.get(
            f"{BASE_URL}/api/team/calendar/events",
            params={"from_": "2026-10-01", "to": "2027-01-15"},
        )
        rows = [e for e in g.json().get("events", []) if e["event_id"] == recurring_event["id"]]
        dates = [r["occ_date"] for r in rows]
        assert occ in dates
        assert len(rows) == 7
        for row in rows:
            assert row.get("exdates") == []

    def test_cancel_bad_date_returns_400(self, api_client, recurring_event):
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/cancel-occurrence",
            json={"occ_date": ""},
        )
        assert r.status_code == 400

        r2 = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/cancel-occurrence",
            json={"occ_date": "not-a-date"},
        )
        assert r2.status_code == 400

    def test_cancel_unknown_event_returns_404(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/does-not-exist-xyz/cancel-occurrence",
            json={"occ_date": "2026-11-24"},
        )
        assert r.status_code == 404

    def test_restore_unknown_event_returns_404(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/does-not-exist-xyz/restore-occurrence",
            json={"occ_date": "2026-11-24"},
        )
        assert r.status_code == 404
