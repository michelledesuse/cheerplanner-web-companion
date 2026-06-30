"""
Tests for v2.2 schedule.team_id linking feature.
- POST /api/schedule with team_id persists
- GET /api/schedule returns team_id
- PATCH /api/schedule/{id} can set & clear team_id
- Regression: events without team_id still work
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "Backend URL env var missing"
BASE_URL = BASE_URL.rstrip("/")

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def a_team(auth_headers):
    r = requests.get(f"{BASE_URL}/api/teams", headers=auth_headers)
    assert r.status_code == 200
    teams = r.json()
    if teams:
        return teams[0]
    # else create one
    payload = {"name": f"TEST_TEAM_{uuid.uuid4().hex[:6]}", "color": "#FF00AA"}
    r = requests.post(f"{BASE_URL}/api/teams", headers=auth_headers, json=payload)
    assert r.status_code in (200, 201)
    return r.json()


@pytest.fixture
def cleanup_ids(auth_headers):
    created = []
    yield created
    for ev_id in created:
        try:
            requests.delete(f"{BASE_URL}/api/schedule/{ev_id}", headers=auth_headers)
        except Exception:
            pass


# -- Create with team_id persists, GET returns it ---------------------------
class TestScheduleTeamLink:
    def test_create_with_team_id_persists(self, auth_headers, a_team, cleanup_ids):
        payload = {
            "title": "TEST_Practice_with_team",
            "event_type": "practice",
            "date": "2026-03-15",
            "team_id": a_team["id"],
        }
        r = requests.post(f"{BASE_URL}/api/schedule", headers=auth_headers, json=payload)
        assert r.status_code == 200, r.text
        events = r.json()
        assert len(events) == 1
        ev = events[0]
        assert ev["team_id"] == a_team["id"]
        assert ev["title"] == "TEST_Practice_with_team"
        cleanup_ids.append(ev["id"])

        # GET /api/schedule returns team_id
        r = requests.get(f"{BASE_URL}/api/schedule", headers=auth_headers)
        assert r.status_code == 200
        found = [e for e in r.json() if e["id"] == ev["id"]]
        assert len(found) == 1
        assert found[0]["team_id"] == a_team["id"]

    def test_create_without_team_id_regression(self, auth_headers, cleanup_ids):
        payload = {
            "title": "TEST_Practice_no_team",
            "event_type": "practice",
            "date": "2026-03-16",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", headers=auth_headers, json=payload)
        assert r.status_code == 200, r.text
        ev = r.json()[0]
        assert ev["team_id"] is None
        cleanup_ids.append(ev["id"])

    def test_patch_set_team_id(self, auth_headers, a_team, cleanup_ids):
        payload = {"title": "TEST_patch_target", "event_type": "practice", "date": "2026-03-17"}
        r = requests.post(f"{BASE_URL}/api/schedule", headers=auth_headers, json=payload)
        ev = r.json()[0]
        cleanup_ids.append(ev["id"])
        assert ev["team_id"] is None

        # Set team_id via PATCH
        r = requests.patch(
            f"{BASE_URL}/api/schedule/{ev['id']}",
            headers=auth_headers,
            json={"team_id": a_team["id"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["events"][0]["team_id"] == a_team["id"]

        # Verify via GET
        r = requests.get(f"{BASE_URL}/api/schedule", headers=auth_headers)
        found = next(e for e in r.json() if e["id"] == ev["id"])
        assert found["team_id"] == a_team["id"]

    def test_patch_clear_team_id_to_null(self, auth_headers, a_team, cleanup_ids):
        payload = {
            "title": "TEST_patch_clear",
            "event_type": "practice",
            "date": "2026-03-18",
            "team_id": a_team["id"],
        }
        r = requests.post(f"{BASE_URL}/api/schedule", headers=auth_headers, json=payload)
        ev = r.json()[0]
        cleanup_ids.append(ev["id"])
        assert ev["team_id"] == a_team["id"]

        # Clear team_id by sending null
        r = requests.patch(
            f"{BASE_URL}/api/schedule/{ev['id']}",
            headers=auth_headers,
            json={"team_id": None},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["events"][0]["team_id"] is None, f"Expected null team_id after clear, got: {body['events'][0]}"

        # Verify via GET
        r = requests.get(f"{BASE_URL}/api/schedule", headers=auth_headers)
        found = next(e for e in r.json() if e["id"] == ev["id"])
        assert found["team_id"] is None
