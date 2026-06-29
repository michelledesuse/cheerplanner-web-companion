"""v1.0.8 — Team logo_image upload tests.

Validates POST/PATCH/GET/DELETE round-trip for Team.logo_image
(base64 data URL field), including:
- create with logo_image persists & is returned by GET
- patch updates logo_image to new value
- patch with logo_image:"" clears it
- delete still works
"""
import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
)
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1]
                break
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"

# 1x1 transparent PNG (tiny base64)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
TINY_PNG_DATA_URL = f"data:image/png;base64,{TINY_PNG_B64}"

# A different second tiny image (1x1 red png)
TINY_PNG2_DATA_URL = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def state():
    return {"team_id": None, "team_no_logo_id": None}


def test_01_create_team_with_logo(client, state):
    r = client.post(f"{BASE_URL}/api/teams", json={
        "name": "TEST_LogoTeam",
        "color": "#0EA5E9",
        "season": "2025-2026",
        "logo_image": TINY_PNG_DATA_URL,
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["name"] == "TEST_LogoTeam"
    assert data["logo_image"] == TINY_PNG_DATA_URL, "logo_image not persisted in create response"
    assert data["logo_shape"] in ("square", "circle")
    state["team_id"] = data["id"]


def test_02_get_teams_includes_logo(client, state):
    r = client.get(f"{BASE_URL}/api/teams")
    assert r.status_code == 200
    teams = r.json()
    me = next((t for t in teams if t["id"] == state["team_id"]), None)
    assert me is not None, "created team not in list"
    assert me["logo_image"] == TINY_PNG_DATA_URL


def test_03_patch_logo_to_new_value(client, state):
    tid = state["team_id"]
    r = client.patch(f"{BASE_URL}/api/teams/{tid}", json={"logo_image": TINY_PNG2_DATA_URL})
    assert r.status_code == 200, r.text
    assert r.json()["logo_image"] == TINY_PNG2_DATA_URL
    # Verify via GET
    r = client.get(f"{BASE_URL}/api/teams")
    me = next(t for t in r.json() if t["id"] == tid)
    assert me["logo_image"] == TINY_PNG2_DATA_URL


def test_04_patch_logo_empty_string_clears(client, state):
    tid = state["team_id"]
    r = client.patch(f"{BASE_URL}/api/teams/{tid}", json={"logo_image": ""})
    assert r.status_code == 200, r.text
    body = r.json()
    # Either empty string or None is acceptable as "cleared"
    assert not body.get("logo_image"), f"expected logo_image cleared, got {body.get('logo_image')!r}"
    # Verify via GET
    r = client.get(f"{BASE_URL}/api/teams")
    me = next(t for t in r.json() if t["id"] == tid)
    assert not me.get("logo_image"), f"GET still shows logo_image: {me.get('logo_image')!r}"


def test_05_create_team_without_logo(client, state):
    r = client.post(f"{BASE_URL}/api/teams", json={
        "name": "TEST_NoLogoTeam",
        "color": "#FF00AA",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["name"] == "TEST_NoLogoTeam"
    assert not data.get("logo_image")
    state["team_no_logo_id"] = data["id"]


def test_06_patch_add_logo_later(client, state):
    """A team created without a logo should be able to acquire one via PATCH."""
    tid = state["team_no_logo_id"]
    r = client.patch(f"{BASE_URL}/api/teams/{tid}", json={"logo_image": TINY_PNG_DATA_URL})
    assert r.status_code == 200, r.text
    assert r.json()["logo_image"] == TINY_PNG_DATA_URL


def test_07_delete_still_works(client, state):
    for key in ("team_id", "team_no_logo_id"):
        tid = state.get(key)
        if not tid:
            continue
        r = client.delete(f"{BASE_URL}/api/teams/{tid}")
        assert r.status_code == 200, r.text
        assert r.json().get("deleted") is True
    # Verify gone
    r = client.get(f"{BASE_URL}/api/teams")
    ids = {t["id"] for t in r.json()}
    assert state["team_id"] not in ids
    assert state["team_no_logo_id"] not in ids
