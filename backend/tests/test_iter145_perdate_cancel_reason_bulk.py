"""Iter145 — Team Hub calendar: Per-Date Location, Cancel Reason, Bulk Cancel, Notify

Covers:
 (a) override-occurrence with location/address — list reflects override on that
     single date + has_override=true; other dates unchanged.
 (b) cancel-occurrence with reason — row stays cancelled=true and
     cancel_reason set.
 (c) cancel-range {from,to,reason} — returns {cancelled:N, dates:[...]} and
     each date shows cancelled=true + cancel_reason.
 (d) restore-occurrence clears cancelled + cancel_reason.
 (e) cancel-range with to < from → 400.
 (f) /api/team/broadcast/send endpoint exists and does NOT 500 (Twilio
     unconfigured in dev → 400 is acceptable).
Cleanup: delete QA145 event at end.
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
    assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL env var required"
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
    """Weekly Monday QA145 event (6 Mondays Nov 2 .. Dec 7, 2026). Delete at teardown."""
    payload = {
        "title": "QA145 Practice",
        "event_type": "practice",
        "date": "2026-11-02",   # Monday
        "start_time": "18:00",
        "end_time": "20:00",
        "recurrence": {"freq": "weekly", "interval": 1, "byweekday": [1], "until": "2026-12-21"},
    }
    r = api_client.post(f"{BASE_URL}/api/team/calendar/events", json=payload)
    assert r.status_code == 200, f"create failed: {r.text}"
    ev = r.json()
    assert ev["id"]
    yield ev
    api_client.delete(f"{BASE_URL}/api/team/calendar/events/{ev['id']}")


def _rows_for(api_client, event_id):
    g = api_client.get(
        f"{BASE_URL}/api/team/calendar/events",
        params={"from_": "2026-10-01", "to": "2027-01-15"},
    )
    assert g.status_code == 200, g.text
    return [e for e in g.json().get("events", []) if e["event_id"] == event_id]


# ---------------------------------------------------------------
# (a) Per-Date Location override
# ---------------------------------------------------------------
class TestPerDateLocation:
    def test_override_location_single_date(self, api_client, recurring_event):
        occ = "2026-11-09"
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/override-occurrence",
            json={"occ_date": occ, "location": "Backup Gym", "address": "9 B St"},
        )
        assert r.status_code == 200, r.text
        rows = _rows_for(api_client, recurring_event["id"])
        target = [row for row in rows if row["occ_date"] == occ]
        assert len(target) == 1
        t = target[0]
        assert t["location"] == "Backup Gym"
        assert t["address"] == "9 B St"
        assert t["has_override"] is True
        # other dates unchanged
        for row in rows:
            if row["occ_date"] == occ:
                continue
            assert row.get("has_override") is False
            assert row.get("location") != "Backup Gym"


# ---------------------------------------------------------------
# (b) Cancel occurrence with reason
# ---------------------------------------------------------------
class TestCancelReason:
    def test_cancel_single_with_reason(self, api_client, recurring_event):
        occ = "2026-11-16"
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/cancel-occurrence",
            json={"occ_date": occ, "reason": "Coach travel"},
        )
        assert r.status_code == 200, r.text
        rows = _rows_for(api_client, recurring_event["id"])
        hit = next((row for row in rows if row["occ_date"] == occ), None)
        assert hit is not None, "cancelled date should remain in list"
        assert hit["cancelled"] is True
        assert hit["cancel_reason"] == "Coach travel"


# ---------------------------------------------------------------
# (c) Cancel-range with reason
# ---------------------------------------------------------------
class TestCancelRange:
    def test_cancel_range_with_reason(self, api_client, recurring_event):
        # Range covers two future Mondays Nov 23 + Nov 30.
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/cancel-range",
            json={"from": "2026-11-23", "to": "2026-12-01", "reason": "Thanksgiving break"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("cancelled") == 2, body
        assert set(body.get("dates") or []) == {"2026-11-23", "2026-11-30"}
        rows = _rows_for(api_client, recurring_event["id"])
        for d in ("2026-11-23", "2026-11-30"):
            hit = next((row for row in rows if row["occ_date"] == d), None)
            assert hit is not None
            assert hit["cancelled"] is True
            assert hit["cancel_reason"] == "Thanksgiving break"

    def test_cancel_range_invalid_bounds(self, api_client, recurring_event):
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/cancel-range",
            json={"from": "2026-12-10", "to": "2026-12-01", "reason": "x"},
        )
        assert r.status_code == 400


# ---------------------------------------------------------------
# (d) Restore clears cancel_reason
# ---------------------------------------------------------------
class TestRestore:
    def test_restore_clears_reason(self, api_client, recurring_event):
        occ = "2026-11-16"  # cancelled above
        r = api_client.post(
            f"{BASE_URL}/api/team/calendar/events/{recurring_event['id']}/restore-occurrence",
            json={"occ_date": occ},
        )
        assert r.status_code == 200, r.text
        rows = _rows_for(api_client, recurring_event["id"])
        hit = next((row for row in rows if row["occ_date"] == occ), None)
        assert hit is not None
        assert hit["cancelled"] is False
        assert hit.get("cancel_reason") in (None, "")


# ---------------------------------------------------------------
# (f) Broadcast send endpoint exists & doesn't 500
# ---------------------------------------------------------------
class TestBroadcastEndpoint:
    def test_broadcast_send_not_500(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/team/broadcast/send",
            json={
                "message": "iter145 self-test (do not spam)",
                "recipients": {"mode": "all"},
                "base_url": BASE_URL,
            },
        )
        # Dev Twilio often unconfigured → 400 acceptable; just not 500 and not 404.
        assert r.status_code != 500, r.text
        assert r.status_code != 404, "broadcast/send endpoint missing"
        # Common dev outcomes: 200 (sent) or 400 ("SMS isn't set up")
        assert r.status_code in (200, 400, 403), f"unexpected {r.status_code}: {r.text}"
