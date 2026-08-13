"""Iter92 — Household Privacy Controls backend re-confirm.

Covers:
- /api/auth/me exposes user.visibility {expenses, travel}
- /api/household returns is_owner + members[].privacy + owner_user_id
- PATCH /api/household/privacy/{user_id}: owner-only, blocks non-owner, self-block 400
- Blocked visibility flips GET /api/expenses & /api/bookings to 403
- /api/dashboard zeroes hidden areas and exposes can_view_expenses/can_view_travel
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

OWNER_EMAIL = "applereview@cheerplanner.app"
OWNER_PASSWORD = "Review2026!"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    return r.json()["access_token"]


def _signup(email: str, password: str, name: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={"email": email, "password": password, "name": name},
    )
    assert r.status_code == 200, f"signup failed {r.status_code}: {r.text}"
    return r.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def coparent_token(owner_token):
    """Create a coparent user, join the owner's household via an invite code."""
    # Fresh coparent
    email = f"TEST_coparent_{uuid.uuid4().hex[:8]}@example.com"
    tok = _signup(email, "TestPass123!", "Test Coparent")
    # Owner generates invite
    inv = requests.post(f"{BASE_URL}/api/household/invite", headers=_h(owner_token), json={})
    assert inv.status_code == 200, inv.text
    code = inv.json()["code"]
    # Coparent joins
    jr = requests.post(f"{BASE_URL}/api/household/join", headers=_h(tok), json={"code": code})
    assert jr.status_code == 200, jr.text
    yield tok
    # cleanup best-effort: coparent leaves
    try:
        requests.post(f"{BASE_URL}/api/household/leave", headers=_h(tok))
    except Exception:
        pass


class TestVisibilityShape:
    def test_owner_auth_me_visibility(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(owner_token))
        assert r.status_code == 200
        body = r.json()
        assert "visibility" in body, f"visibility missing from /auth/me: {body}"
        assert body["visibility"] == {"expenses": True, "travel": True}

    def test_household_shape_owner(self, owner_token, coparent_token):
        r = requests.get(f"{BASE_URL}/api/household", headers=_h(owner_token))
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("is_owner") is True
        assert "owner_user_id" in b and b["owner_user_id"]
        members = b.get("members") or []
        assert len(members) >= 2, f"expected owner + coparent, got {members}"
        for m in members:
            assert "privacy" in m
            assert set(m["privacy"].keys()) == {"expenses", "travel"}
            assert "is_owner" in m


class TestPrivacyPermissions:
    def test_non_owner_cannot_patch(self, coparent_token, owner_token):
        # find owner id
        r = requests.get(f"{BASE_URL}/api/household", headers=_h(owner_token))
        owner_id = r.json()["owner_user_id"]
        # coparent tries to patch owner's privacy -> should be 403
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(coparent_token)).json()
        cp_id = me["id"]
        resp = requests.patch(
            f"{BASE_URL}/api/household/privacy/{cp_id}",
            headers=_h(coparent_token),
            json={"expenses": False},
        )
        assert resp.status_code == 403, resp.text

    def test_owner_cannot_block_self(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/household", headers=_h(owner_token))
        owner_id = r.json()["owner_user_id"]
        resp = requests.patch(
            f"{BASE_URL}/api/household/privacy/{owner_id}",
            headers=_h(owner_token),
            json={"expenses": False},
        )
        assert resp.status_code == 400, resp.text


class TestBlockedMemberExperience:
    def _cp_id(self, tok):
        return requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tok)).json()["id"]

    def test_block_expenses_returns_403_and_zeroes_dashboard(self, owner_token, coparent_token):
        cp_id = self._cp_id(coparent_token)
        # Block expenses
        r = requests.patch(
            f"{BASE_URL}/api/household/privacy/{cp_id}",
            headers=_h(owner_token),
            json={"expenses": False, "travel": True},
        )
        assert r.status_code == 200, r.text
        assert r.json()["privacy"]["expenses"] is False
        # /auth/me for coparent reflects visibility
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(coparent_token)).json()
        assert me["visibility"]["expenses"] is False
        assert me["visibility"]["travel"] is True
        # /expenses -> 403
        e = requests.get(f"{BASE_URL}/api/expenses", headers=_h(coparent_token))
        assert e.status_code == 403, e.text
        # /bookings -> 200 (travel still visible)
        b = requests.get(f"{BASE_URL}/api/bookings", headers=_h(coparent_token))
        assert b.status_code == 200, b.text
        # /dashboard hides finance fields
        d = requests.get(f"{BASE_URL}/api/dashboard", headers=_h(coparent_token))
        assert d.status_code == 200
        body = d.json()
        assert body["can_view_expenses"] is False
        assert body["can_view_travel"] is True
        assert body["total_expenses_ytd"] == 0.0
        assert body["total_payments_ytd"] == 0.0
        assert body["month_spend"] == 0.0
        assert body["unpaid_expense_balance"] == 0.0

    def test_block_travel_returns_403(self, owner_token, coparent_token):
        cp_id = self._cp_id(coparent_token)
        r = requests.patch(
            f"{BASE_URL}/api/household/privacy/{cp_id}",
            headers=_h(owner_token),
            json={"expenses": True, "travel": False},
        )
        assert r.status_code == 200, r.text
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(coparent_token)).json()
        assert me["visibility"]["travel"] is False
        assert me["visibility"]["expenses"] is True
        b = requests.get(f"{BASE_URL}/api/bookings", headers=_h(coparent_token))
        assert b.status_code == 403, b.text
        e = requests.get(f"{BASE_URL}/api/expenses", headers=_h(coparent_token))
        assert e.status_code == 200
        d = requests.get(f"{BASE_URL}/api/dashboard", headers=_h(coparent_token)).json()
        assert d["can_view_travel"] is False
        assert d["can_view_expenses"] is True
        assert d["booking_balance"] == 0.0

    def test_owner_never_blocked(self, owner_token):
        # Even after blocking coparent, owner's /expenses and /bookings still 200.
        e = requests.get(f"{BASE_URL}/api/expenses", headers=_h(owner_token))
        assert e.status_code == 200
        b = requests.get(f"{BASE_URL}/api/bookings", headers=_h(owner_token))
        assert b.status_code == 200
        d = requests.get(f"{BASE_URL}/api/dashboard", headers=_h(owner_token)).json()
        assert d["can_view_expenses"] is True
        assert d["can_view_travel"] is True

    def test_restore_visibility(self, owner_token, coparent_token):
        cp_id = self._cp_id(coparent_token)
        r = requests.patch(
            f"{BASE_URL}/api/household/privacy/{cp_id}",
            headers=_h(owner_token),
            json={"expenses": True, "travel": True},
        )
        assert r.status_code == 200
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(coparent_token)).json()
        assert me["visibility"] == {"expenses": True, "travel": True}
