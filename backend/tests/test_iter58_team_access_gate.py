"""Iteration 58 — Per-login Team Hub access gate.

Covers:
- GET /api/auth/me returns team_access field
- Login response includes team_access
- PATCH /api/auth/team-access {enabled} updates flag + returns UserPublic
- Team Hub endpoints (roster, team/payments, team/sizes, team/paperwork, team/signups)
  return 200 when team_access=true, 403 when team_access=false, 401 unauth.
- Signup response includes team_access on both login and me.
- Ensures applereview is left with team_access=true at the end.
"""
import os
import uuid
import pytest
import requests
from dotenv import dotenv_values

# Preview URL from frontend/.env (EXPO_BACKEND_URL not exported in shell)
_env = dotenv_values("/app/frontend/.env")
BASE_URL = (_env.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing from /app/frontend/.env"

APPLE_EMAIL = "applereview@cheerplanner.app"
APPLE_PASS = "Review2026!"

TEAM_HUB_ENDPOINTS = [
    "/api/roster",
    "/api/team/payments",
    "/api/team/sizes",
    "/api/team/paperwork",
    "/api/team/signups",
]


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def apple_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": APPLE_EMAIL, "password": APPLE_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    assert "user" in data
    return data["access_token"], data["user"]


@pytest.fixture(scope="module")
def apple_headers(apple_token):
    token, _ = apple_token
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def _ensure_team_access_restored(apple_headers):
    """Guarantee applereview ends with team_access=true regardless of test outcome."""
    yield
    try:
        requests.patch(f"{BASE_URL}/api/auth/team-access",
                       json={"enabled": True}, headers=apple_headers, timeout=15)
    except Exception:
        pass


# ---------- 1) Login/me include team_access ----------
class TestAuthShape:
    def test_login_includes_team_access(self, apple_token):
        _, user = apple_token
        assert "team_access" in user, "login response.user missing team_access"
        assert user["team_access"] is True, f"applereview should have team_access=true, got {user['team_access']}"

    def test_me_includes_team_access(self, apple_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=apple_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "team_access" in body
        assert body["team_access"] is True
        assert body["email"] == APPLE_EMAIL

    def test_signup_new_user_defaults_team_access_false(self):
        """New signups must default to team_access=false."""
        email = f"test_gate_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/signup",
                          json={"email": email, "password": "Testing123!", "name": "TEST_Gate"},
                          timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # signup UserPublic falls back to default team_access=False
        assert data["user"].get("team_access", False) is False, \
            f"new signup should have team_access=false, got {data['user'].get('team_access')}"

        # And Team Hub should 403 for the new user
        headers = {"Authorization": f"Bearer {data['access_token']}",
                   "Content-Type": "application/json"}
        for ep in TEAM_HUB_ENDPOINTS:
            resp = requests.get(f"{BASE_URL}{ep}", headers=headers, timeout=15)
            assert resp.status_code == 403, \
                f"{ep} should 403 for non-personnel, got {resp.status_code} body={resp.text[:200]}"

        # Cleanup: delete the throwaway user
        requests.request(
            "DELETE", f"{BASE_URL}/api/auth/me",
            json={"password": "Testing123!"}, headers=headers, timeout=15,
        )


# ---------- 2) Team Hub endpoints with team_access=true ----------
class TestTeamHubUnlockedForPersonnel:
    @pytest.mark.parametrize("endpoint", TEAM_HUB_ENDPOINTS)
    def test_endpoint_returns_200(self, apple_headers, endpoint):
        r = requests.get(f"{BASE_URL}{endpoint}", headers=apple_headers, timeout=20)
        assert r.status_code == 200, f"{endpoint} => {r.status_code} {r.text[:200]}"
        # basic sanity — must be JSON (list or dict)
        body = r.json()
        assert isinstance(body, (list, dict)), f"{endpoint} returned non-JSON body"


# ---------- 3) Unauthenticated -> 401 ----------
class TestTeamHubUnauth:
    @pytest.mark.parametrize("endpoint", TEAM_HUB_ENDPOINTS)
    def test_endpoint_returns_401_without_token(self, endpoint):
        r = requests.get(f"{BASE_URL}{endpoint}", timeout=15)
        assert r.status_code == 401, f"{endpoint} unauth => {r.status_code} {r.text[:200]}"


# ---------- 4) PATCH toggle -> 403 then restore -> 200 ----------
class TestPatchTeamAccessGates:
    def test_patch_toggle_flow(self, apple_headers):
        # Turn OFF
        r = requests.patch(f"{BASE_URL}/api/auth/team-access",
                           json={"enabled": False}, headers=apple_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["team_access"] is False, f"expected team_access=false after PATCH, got {body}"
        # Confirm GET /me reflects the change
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=apple_headers, timeout=15).json()
        assert me["team_access"] is False

        # All Team Hub endpoints must 403 now
        for ep in TEAM_HUB_ENDPOINTS:
            resp = requests.get(f"{BASE_URL}{ep}", headers=apple_headers, timeout=15)
            assert resp.status_code == 403, \
                f"{ep} should 403 when team_access=false, got {resp.status_code} {resp.text[:200]}"

        # Turn ON again
        r = requests.patch(f"{BASE_URL}/api/auth/team-access",
                           json={"enabled": True}, headers=apple_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["team_access"] is True, f"expected team_access=true after restore, got {body}"

        # Team Hub endpoints back to 200
        for ep in TEAM_HUB_ENDPOINTS:
            resp = requests.get(f"{BASE_URL}{ep}", headers=apple_headers, timeout=15)
            assert resp.status_code == 200, \
                f"{ep} should 200 after re-enable, got {resp.status_code} {resp.text[:200]}"

    def test_patch_requires_auth(self):
        r = requests.patch(f"{BASE_URL}/api/auth/team-access",
                           json={"enabled": True}, timeout=15)
        assert r.status_code == 401
