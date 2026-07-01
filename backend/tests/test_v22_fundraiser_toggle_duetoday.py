"""CheerPlanner v2.2 backend tests:
- Fundraiser schedule event type accepted by POST /api/schedule and appears in /api/calendar
- Teams-to-Watch import respects create_missing_competitions toggle
- Dashboard due_today sums unpaid expense balances and booking balances whose due date is today
"""
import os
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"

TODAY = datetime.now(timezone.utc).date().isoformat()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ─── FUNDRAISER TYPE ────────────────────────────────────────────────────
class TestFundraiserEventType:
    def test_create_fundraiser_schedule_event(self, client):
        payload = {
            "event_type": "fundraiser",
            "title": "TEST_Fundraiser Car Wash",
            "date": TODAY,
            "location": "TEST location",
        }
        r = client.post(f"{BASE_URL}/api/schedule", json=payload)
        assert r.status_code in (200, 201), r.text
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        data = arr[0]
        assert data.get("event_type") == "fundraiser"
        assert data.get("title") == "TEST_Fundraiser Car Wash"
        assert data.get("id")
        pytest._fundraiser_id = data["id"]

    def test_fundraiser_listed_in_schedule(self, client):
        r = client.get(f"{BASE_URL}/api/schedule")
        assert r.status_code == 200
        ev = next((e for e in r.json() if e.get("id") == pytest._fundraiser_id), None)
        assert ev is not None
        assert ev["event_type"] == "fundraiser"

    def test_fundraiser_appears_on_calendar(self, client):
        r = client.get(f"{BASE_URL}/api/calendar", params={"start": TODAY, "end": TODAY})
        assert r.status_code == 200
        items = r.json().get("items", [])
        match = [i for i in items if i.get("kind") == "schedule" and pytest._fundraiser_id in i.get("id", "")]
        assert len(match) == 1, f"Expected fundraiser schedule item on calendar. Items: {items[:5]}"
        assert match[0]["color"] == "#16A34A", f"Expected green color, got {match[0]['color']}"

    def test_cleanup_fundraiser(self, client):
        r = client.delete(f"{BASE_URL}/api/schedule/{pytest._fundraiser_id}?scope=single")
        assert r.status_code in (200, 204)


# ─── TEAMS-TO-WATCH TOGGLE ──────────────────────────────────────────────
class TestTeamsToWatchToggle:
    def _get_comp_names(self, client):
        r = client.get(f"{BASE_URL}/api/competitions")
        assert r.status_code == 200
        return [c["name"] for c in r.json()], r.json()

    def test_skip_when_toggle_off(self, client):
        names_before, _ = self._get_comp_names(client)
        typo = "TEST_NoMatchComp_Skip_XYZ"
        payload = {
            "kind": "teams_to_watch",
            "rows": [
                {"name": "TEST_Team_Skip", "competition": typo, "date": TODAY}
            ],
            "create_missing_competitions": False,
        }
        r = client.post(f"{BASE_URL}/api/import/commit", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] == 0
        assert data["skipped"] == 1
        assert any(typo in w for w in data.get("warnings", []))

        names_after, _ = self._get_comp_names(client)
        assert typo not in names_after, "Competition should NOT have been created when toggle is OFF"

    def test_create_when_toggle_on(self, client):
        typo = "TEST_NoMatchComp_Create_XYZ"
        payload = {
            "kind": "teams_to_watch",
            "rows": [
                {"name": "TEST_Team_Create", "competition": typo, "date": TODAY, "location": "TEST loc"}
            ],
            "create_missing_competitions": True,
        }
        r = client.post(f"{BASE_URL}/api/import/commit", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] == 1
        assert data["skipped"] == 0

        names_after, comps = self._get_comp_names(client)
        assert typo in names_after, "Competition SHOULD have been created when toggle is ON"

        created = next(c for c in comps if c["name"] == typo)
        assert any(t.get("name") == "TEST_Team_Create" for t in (created.get("teams_to_watch") or []))
        pytest._created_comp_id = created["id"]

    def test_cleanup_created_comp(self, client):
        cid = getattr(pytest, "_created_comp_id", None)
        if cid:
            r = client.delete(f"{BASE_URL}/api/competitions/{cid}")
            assert r.status_code in (200, 204, 404)


# ─── DASHBOARD DUE_TODAY ────────────────────────────────────────────────
class TestDashboardDueToday:
    def test_due_today_increments_after_creating_expense(self, client):
        # Baseline
        r = client.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200
        base_due = float(r.json().get("due_today", 0))

        # Need at least one athlete
        athletes = client.get(f"{BASE_URL}/api/athletes").json()
        assert athletes, "Seed data missing athletes"
        aid = athletes[0]["id"]

        exp_payload = {
            "athlete_id": aid,
            "category": "TEST_DueToday",
            "amount": 123.45,
            "incurred_on": TODAY,
            "due_date": TODAY,
            "paid": False,
        }
        r = client.post(f"{BASE_URL}/api/expenses", json=exp_payload)
        assert r.status_code in (200, 201), r.text
        rj = r.json()
        exp_obj = rj[0] if isinstance(rj, list) else rj
        exp_id = exp_obj["id"]
        pytest._exp_id = exp_id

        r = client.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200
        new_due = float(r.json().get("due_today", 0))
        assert round(new_due - base_due, 2) == 123.45, f"Expected +123.45, got {new_due - base_due}"

    def test_due_today_is_numeric(self, client):
        r = client.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200
        val = r.json().get("due_today")
        assert isinstance(val, (int, float)), f"due_today should be numeric, got {type(val)}"

    def test_cleanup_expense(self, client):
        exp_id = getattr(pytest, "_exp_id", None)
        if exp_id:
            r = client.delete(f"{BASE_URL}/api/expenses/{exp_id}")
            assert r.status_code in (200, 204)
