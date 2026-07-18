"""Iteration 53 — Phase A backend tests for athlete roles.

Verifies:
- POST/PATCH /api/athletes accept the four allowed role values
- 422 on invalid role
- role round-trips on GET
- existing athlete (role=coach or athlete) still works
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"

ALLOWED_ROLES = ["athlete", "coach", "team_rep", "staff"]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def created_ids(session):
    ids = []
    yield ids
    for aid in ids:
        try:
            session.delete(f"{BASE_URL}/api/athletes/{aid}", timeout=10)
        except Exception:
            pass


@pytest.mark.parametrize("role", ALLOWED_ROLES)
def test_create_athlete_with_each_role_and_get_roundtrip(session, created_ids, role):
    payload = {"name": f"TEST_{role}_role", "role": role, "avatar_color": "#123456"}
    r = session.post(f"{BASE_URL}/api/athletes", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"POST failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["role"] == role, f"role echoed wrong on POST: {body}"
    aid = body["id"]
    created_ids.append(aid)

    # GET list and confirm persisted role
    gr = session.get(f"{BASE_URL}/api/athletes", timeout=15)
    assert gr.status_code == 200
    row = next((x for x in gr.json() if x["id"] == aid), None)
    assert row is not None, "created athlete not returned in GET /athletes"
    assert row["role"] == role


def test_patch_updates_role_to_team_rep(session, created_ids):
    # start as athlete
    r = session.post(f"{BASE_URL}/api/athletes", json={"name": "TEST_patch_role", "role": "athlete"}, timeout=15)
    assert r.status_code in (200, 201)
    aid = r.json()["id"]
    created_ids.append(aid)

    pr = session.patch(f"{BASE_URL}/api/athletes/{aid}", json={"role": "team_rep"}, timeout=15)
    assert pr.status_code in (200, 204), f"PATCH failed: {pr.status_code} {pr.text}"
    if pr.status_code == 200:
        assert pr.json().get("role") == "team_rep"

    gr = session.get(f"{BASE_URL}/api/athletes", timeout=15)
    row = next(x for x in gr.json() if x["id"] == aid)
    assert row["role"] == "team_rep"


def test_patch_updates_role_to_staff(session, created_ids):
    r = session.post(f"{BASE_URL}/api/athletes", json={"name": "TEST_patch_staff", "role": "coach"}, timeout=15)
    assert r.status_code in (200, 201)
    aid = r.json()["id"]
    created_ids.append(aid)

    pr = session.patch(f"{BASE_URL}/api/athletes/{aid}", json={"role": "staff"}, timeout=15)
    assert pr.status_code in (200, 204)

    gr = session.get(f"{BASE_URL}/api/athletes", timeout=15)
    row = next(x for x in gr.json() if x["id"] == aid)
    assert row["role"] == "staff"


def test_invalid_role_rejected_on_create(session):
    r = session.post(
        f"{BASE_URL}/api/athletes",
        json={"name": "TEST_bad_role", "role": "captain"},
        timeout=15,
    )
    assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"


def test_invalid_role_rejected_on_patch(session, created_ids):
    r = session.post(f"{BASE_URL}/api/athletes", json={"name": "TEST_patch_bad", "role": "athlete"}, timeout=15)
    aid = r.json()["id"]
    created_ids.append(aid)

    pr = session.patch(f"{BASE_URL}/api/athletes/{aid}", json={"role": "manager"}, timeout=15)
    assert pr.status_code == 422, f"expected 422, got {pr.status_code} {pr.text}"


def test_role_defaults_to_athlete_when_omitted(session, created_ids):
    r = session.post(f"{BASE_URL}/api/athletes", json={"name": "TEST_default_role"}, timeout=15)
    assert r.status_code in (200, 201)
    body = r.json()
    created_ids.append(body["id"])
    assert body.get("role") == "athlete"


def test_existing_coach_role_still_accepted(session, created_ids):
    """Regression: coach role from the previous 2-choice selector must still work."""
    r = session.post(f"{BASE_URL}/api/athletes", json={"name": "TEST_legacy_coach", "role": "coach"}, timeout=15)
    assert r.status_code in (200, 201)
    body = r.json()
    created_ids.append(body["id"])
    assert body["role"] == "coach"
