"""Iteration 62 — Owner-controlled Team Hub access delegation.

Verifies /api/team-access/* endpoints (owner-only management) and the
grant_team_access flow through /api/household/join.
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")

OWNER_EMAIL = "applereview@cheerplanner.app"
OWNER_PASSWORD = "Review2026!"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _signup(email, password, name="TEST User"):
    r = requests.post(f"{BASE_URL}/api/auth/signup", json={"email": email, "password": password, "name": name}, timeout=30)
    assert r.status_code in (200, 201), f"signup failed: {r.status_code} {r.text}"
    return r.json()["access_token"], r.json()["user"]


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def owner_id(owner_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_headers(owner_token))
    assert r.status_code == 200
    return r.json()["id"]


# ------------- GET /api/team-access -------------
class TestGetTeamAccess:
    def test_returns_owner_shape(self, owner_token, owner_id):
        r = requests.get(f"{BASE_URL}/api/team-access", headers=_headers(owner_token))
        assert r.status_code == 200
        d = r.json()
        assert d["is_owner"] is True
        assert d["owner_user_id"] == owner_id
        assert isinstance(d["members"], list) and len(d["members"]) >= 1
        assert isinstance(d["invites"], list)
        me = next(m for m in d["members"] if m["id"] == owner_id)
        assert me["is_owner"] is True
        assert me["team_access"] is True
        for key in ("id", "email", "name", "team_access", "is_owner"):
            assert key in me


# ------------- PATCH /api/team-access/members/{user_id} -------------
class TestPatchMember:
    def test_owner_can_toggle_self_off_then_on(self, owner_token, owner_id):
        # off
        r = requests.patch(f"{BASE_URL}/api/team-access/members/{owner_id}",
                           headers=_headers(owner_token), json={"enabled": False})
        assert r.status_code == 200, r.text
        assert r.json()["team_access"] is False
        # verify via GET
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_headers(owner_token)).json()
        assert me["team_access"] is False
        # And Team Hub should be gated now
        rgated = requests.get(f"{BASE_URL}/api/roster", headers=_headers(owner_token))
        assert rgated.status_code == 403
        # restore ON (cleanup!)
        r2 = requests.patch(f"{BASE_URL}/api/team-access/members/{owner_id}",
                            headers=_headers(owner_token), json={"enabled": True})
        assert r2.status_code == 200
        assert r2.json()["team_access"] is True
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_headers(owner_token)).json()
        assert me2["team_access"] is True

    def test_non_member_user_id_returns_404(self, owner_token):
        bogus = str(uuid.uuid4())
        r = requests.patch(f"{BASE_URL}/api/team-access/members/{bogus}",
                           headers=_headers(owner_token), json={"enabled": True})
        assert r.status_code == 404


# ------------- POST /api/team-access/invite -------------
class TestInvite:
    def test_invite_new_email_returns_code(self, owner_token):
        email = f"TEST_invite_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{BASE_URL}/api/team-access/invite",
                          headers=_headers(owner_token), json={"email": email})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("invited") is True
        assert d.get("code") and len(d["code"]) == 6
        assert d["email"] == email.lower()
        assert d.get("expires_at")
        # Should appear in GET invites list
        g = requests.get(f"{BASE_URL}/api/team-access", headers=_headers(owner_token)).json()
        codes = [i["code"] for i in g["invites"]]
        assert d["code"] in codes
        # Clean up: delete the invite
        inv = next(i for i in g["invites"] if i["code"] == d["code"])
        rd = requests.delete(f"{BASE_URL}/api/team-access/invite/{inv['id']}", headers=_headers(owner_token))
        assert rd.status_code == 200
        assert rd.json().get("revoked") is True

    def test_delete_missing_invite_returns_404(self, owner_token):
        r = requests.delete(f"{BASE_URL}/api/team-access/invite/{uuid.uuid4()}",
                            headers=_headers(owner_token))
        assert r.status_code == 404


# ------------- Non-owner authorization -------------
class TestNonOwnerAuth:
    """Create a 2nd user, join owner's household, then hit management endpoints."""

    @pytest.fixture(scope="class")
    def joined(self, owner_token, owner_id):
        # 1) owner creates a normal household invite
        r = requests.post(f"{BASE_URL}/api/household/invite", headers=_headers(owner_token))
        assert r.status_code == 200, r.text
        code = r.json()["code"]

        # 2) sign up a 2nd user
        email = f"TEST_member_{uuid.uuid4().hex[:8]}@example.com"
        pw = "TestPass123!"
        tok2, user2 = _signup(email, pw)
        # 3) 2nd user joins
        rj = requests.post(f"{BASE_URL}/api/household/join",
                           headers=_headers(tok2), json={"code": code})
        assert rj.status_code == 200, rj.text
        assert rj.json().get("team_access") is False  # not a team-access invite
        yield {"token": tok2, "user": user2}
        # teardown: remove them from owner's household
        try:
            requests.post(f"{BASE_URL}/api/household/leave", headers=_headers(tok2))
        except Exception:
            pass

    def test_get_team_access_shows_is_owner_false(self, joined):
        r = requests.get(f"{BASE_URL}/api/team-access", headers=_headers(joined["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["is_owner"] is False
        # invites list must be empty for non-owner
        assert d["invites"] == []

    def test_non_owner_patch_403(self, joined):
        r = requests.patch(f"{BASE_URL}/api/team-access/members/{joined['user']['id']}",
                           headers=_headers(joined["token"]), json={"enabled": True})
        assert r.status_code == 403
        assert "owner" in r.json().get("detail", "").lower()

    def test_non_owner_invite_403(self, joined):
        r = requests.post(f"{BASE_URL}/api/team-access/invite",
                          headers=_headers(joined["token"]), json={"email": "x@example.com"})
        assert r.status_code == 403

    def test_non_owner_delete_403(self, joined):
        r = requests.delete(f"{BASE_URL}/api/team-access/invite/{uuid.uuid4()}",
                            headers=_headers(joined["token"]))
        assert r.status_code == 403


# ------------- Invite existing member -> granted:true -------------
class TestGrantExistingMember:
    def test_invite_existing_household_member_grants_directly(self, owner_token, owner_id):
        # setup: create 2nd member and join
        r = requests.post(f"{BASE_URL}/api/household/invite", headers=_headers(owner_token))
        code = r.json()["code"]
        email = f"TEST_grant_{uuid.uuid4().hex[:8]}@example.com"
        tok2, user2 = _signup(email, "TestPass123!")
        rj = requests.post(f"{BASE_URL}/api/household/join",
                           headers=_headers(tok2), json={"code": code})
        assert rj.status_code == 200

        # owner invites the same email
        rinv = requests.post(f"{BASE_URL}/api/team-access/invite",
                             headers=_headers(owner_token), json={"email": email})
        assert rinv.status_code == 200
        d = rinv.json()
        assert d.get("granted") is True
        assert d.get("user_id") == user2["id"]

        # verify user2 now has team_access=True
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_headers(tok2)).json()
        assert me2.get("team_access") is True

        # cleanup: remove them
        requests.post(f"{BASE_URL}/api/household/leave", headers=_headers(tok2))


# ------------- /api/household/join grants team_access when invite has grant_team_access -------------
class TestJoinGrantsTeamAccess:
    def test_email_invite_join_grants_access(self, owner_token):
        # 1) owner creates a team-access email invite (person NOT yet a user)
        email = f"TEST_ta_{uuid.uuid4().hex[:8]}@example.com"
        rinv = requests.post(f"{BASE_URL}/api/team-access/invite",
                             headers=_headers(owner_token), json={"email": email})
        assert rinv.status_code == 200
        d = rinv.json()
        assert d.get("invited") is True
        code = d["code"]

        # 2) that person signs up (with same/other email — irrelevant to invite code)
        tok2, user2 = _signup(email, "TestPass123!")
        # confirm they start with team_access False
        assert user2.get("team_access") in (False, None)

        # 3) join using the team-access code
        rj = requests.post(f"{BASE_URL}/api/household/join",
                           headers=_headers(tok2), json={"code": code})
        assert rj.status_code == 200, rj.text
        body = rj.json()
        assert body.get("joined") is True
        assert body.get("team_access") is True

        # 4) verify /api/auth/me reflects team_access=True
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_headers(tok2)).json()
        assert me2.get("team_access") is True

        # cleanup: leave household
        requests.post(f"{BASE_URL}/api/household/leave", headers=_headers(tok2))


# ------------- Final safety net: ensure owner still has team_access ON -------------
def test_zzz_owner_team_access_restored():
    tok = _login(OWNER_EMAIL, OWNER_PASSWORD)
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=_headers(tok)).json()
    if not me.get("team_access"):
        # restore
        r = requests.patch(f"{BASE_URL}/api/team-access/members/{me['id']}",
                           headers=_headers(tok), json={"enabled": True})
        assert r.status_code == 200
    me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_headers(tok)).json()
    assert me2.get("team_access") is True

    # Also clean up any TEST_ invites left behind
    d = requests.get(f"{BASE_URL}/api/team-access", headers=_headers(tok)).json()
    for inv in d.get("invites", []):
        if (inv.get("email") or "").startswith("TEST_"):
            requests.delete(f"{BASE_URL}/api/team-access/invite/{inv['id']}", headers=_headers(tok))
