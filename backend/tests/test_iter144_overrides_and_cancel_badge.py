"""Iter144 — Team Hub single-date override + cancelled-badge tests.

Covers:
- Create weekly recurring event; GET expands to N dates all with
  has_override=false, cancelled=false.
- POST override-occurrence sets start_time/end_time/notes on ONE date; GET
  shows ONLY that date reflecting the new values + has_override=true,
  others unchanged + has_override=false.
- POST clear-override reverts that date (has_override=false, series times).
- POST cancel-occurrence marks a different date cancelled=true; the row
  REMAINS in the list (iter144 behaviour), not removed.
- override-occurrence with empty occ_date -> 400; unknown event id -> 404.
"""
import os
from datetime import date

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or ""
).rstrip("/")
DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASS = "CheerDemo2026!"


@pytest.fixture(scope="module")
def api_client():
    assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL env var is required"
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
    """Weekly Monday QA144 event; delete afterwards."""
    # Mondays in Nov-Dec 2026. Team byweekday Sun=0..Sat=6 -> Monday = 1.
    start_date = date(2026, 11, 2)  # Monday
    until = date(2026, 12, 10)
    payload = {
        "title": "QA144 Practice",
        "event_type": "practice",
        "date": start_date.isoformat(),
        "start_time": "18:00",
        "end_time": "20:00",
        "recurrence": {"freq": "weekly", "interval": 1, "byweekday": [1], "until": until.isoformat()},
    }
    r = api_client.post(f"{BASE_URL}/api/team/calendar/events", json=payload)
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
    ev = r.json()
    assert ev["id"]
    yield ev
    api_client.delete(f"{BASE_URL}/api/team/calendar/events/{ev['id']}")


def _list_my_rows(api_client, event_id):
    g = api_client.get(
        f"{BASE_URL}/api/team/calendar/events",
        params={"from_": "2026-10-01", "to": "2027-01-15"},
    )
    assert g.status_code == 200, g.text
    return [e for e in g.json().get("events", []) if e["event_id"] == event_id]


class TestOverrideOccurrence:
    def test_initial_expansion_no_overrides(self, api_client, recurring_event):
        rows = _list_my_rows(api_client, recurring_event["id"])
        # Mondays 2026-11-02 .. 2026-12-07 inclusive = 6 occurrences
        assert len(rows) == 6, [r["occ_date"] for r in rows]
        for row in rows:
            assert row["start_time"] == "18:00"
            assert row["end_time"] == "20:00"
            assert row.get("has_override") is False
            assert row.get("cancelled") is False
            assert row.get("recurring") is True

    def test_override_one_date_only(self, api_client, recurring_event):
        occ = "2026-11-16"  # middle Monday
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/override-occurrence",
            json={"occ_date": occ, "start_time": "17:00", "end_time": "19:00", "notes": "Early start"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        rows = _list_my_rows(api_client, recurring_event["id"])
        assert len(rows) == 6  # same count, override does not remove
        target = [row for row in rows if row["occ_date"] == occ]
        assert len(target) == 1
        t = target[0]
        assert t["start_time"] == "17:00"
        assert t["end_time"] == "19:00"
        assert t["notes"] == "Early start"
        assert t["has_override"] is True
        assert t["cancelled"] is False

        for row in rows:
            if row["occ_date"] == occ:
                continue
            assert row["start_time"] == "18:00"
            assert row["end_time"] == "20:00"
            assert row.get("has_override") is False

    def test_clear_override_reverts(self, api_client, recurring_event):
        occ = "2026-11-16"
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/clear-override",
            json={"occ_date": occ},
        )
        assert r.status_code == 200, r.text

        rows = _list_my_rows(api_client, recurring_event["id"])
        target = [row for row in rows if row["occ_date"] == occ]
        assert len(target) == 1
        t = target[0]
        assert t["start_time"] == "18:00"
        assert t["end_time"] == "20:00"
        assert t.get("has_override") is False

    def test_cancel_occurrence_keeps_row_with_cancelled_true(self, api_client, recurring_event):
        occ = "2026-11-23"  # different Monday
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/cancel-occurrence",
            json={"occ_date": occ},
        )
        assert r.status_code == 200, r.text

        rows = _list_my_rows(api_client, recurring_event["id"])
        # iter144: cancelled date REMAINS in list_events with cancelled: true
        dates = [row["occ_date"] for row in rows]
        assert occ in dates, f"cancelled date should still appear in list; got {dates}"
        cancelled_row = next(row for row in rows if row["occ_date"] == occ)
        assert cancelled_row["cancelled"] is True
        # Other dates remain not cancelled
        for row in rows:
            if row["occ_date"] != occ:
                assert row.get("cancelled") is False

        # clean up: restore so later tests see a clean series
        api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/restore-occurrence",
            json={"occ_date": occ},
        )

    def test_override_empty_occ_date_returns_400(self, api_client, recurring_event):
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/override-occurrence",
            json={"occ_date": "", "start_time": "17:00"},
        )
        assert r.status_code == 400

    def test_override_unknown_event_returns_404(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/does-not-exist-xyz/override-occurrence",
            json={"occ_date": "2026-11-16", "start_time": "17:00"},
        )
        assert r.status_code == 404

    def test_override_empty_body_returns_400(self, api_client, recurring_event):
        """override with occ_date valid but no fields -> 400 'Nothing to change'."""
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/override-occurrence",
            json={"occ_date": "2026-11-30"},
        )
        assert r.status_code == 400
