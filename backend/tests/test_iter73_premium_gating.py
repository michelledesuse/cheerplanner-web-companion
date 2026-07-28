"""Iteration 73 — Phase 0/1 Free vs Premium + admin + gating.

Covers:
  - /api/entitlements/me + /config
  - /api/premium/status + /api/premium/redeem
  - Admin gating and code lifecycle
  - Team Hub gating for FREE vs PREMIUM users
  - Regression on team-access + household/team-hub decoupling
"""
import os
import time
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
# Fallback: read from frontend .env
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

# Mongo — for setup only (mark test users as admin/team_access)
MONGO_URL = None
DB_NAME = None
with open("/app/backend/.env") as f:
    for line in f:
        if line.startswith("MONGO_URL="):
            MONGO_URL = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("DB_NAME="):
            DB_NAME = line.split("=", 1)[1].strip().strip('"')

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

PREM_EMAIL = "applereview@cheerplanner.app"
PREM_PASSWORD = "Review2026!"


def _post(path, token=None, json=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.post(f"{BASE_URL}{path}", json=json or {}, headers=h)


def _get(path, token=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.get(f"{BASE_URL}{path}", headers=h)


def _patch(path, token=None, json=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.patch(f"{BASE_URL}{path}", json=json or {}, headers=h)


def _delete(path, token=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.delete(f"{BASE_URL}{path}", headers=h)


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _signup(email, password, name=None):
    r = requests.post(f"{BASE_URL}/api/auth/signup", json={
        "email": email, "password": password, "name": name or email.split("@")[0],
    })
    assert r.status_code in (200, 201), r.text
    return r.json()


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------
_created_user_ids: list = []


@pytest.fixture(scope="module")
def premium_user():
    data = _login(PREM_EMAIL, PREM_PASSWORD)
    return {"token": data["access_token"], "user": data["user"]}


@pytest.fixture(scope="module")
def free_team_user():
    email = f"TEST_free_{uuid.uuid4().hex[:8]}@t.com"
    data = _signup(email, "Passw0rd!")
    token = data["access_token"]
    user_id = data["user"]["id"]
    _created_user_ids.append(user_id)
    # elevate to team_access (Free tier)
    db.users.update_one({"id": user_id}, {"$set": {"team_access": True}})
    # ensure NO entitlement
    db.entitlements.delete_many({"user_id": user_id})
    return {"token": token, "user_id": user_id, "email": email}


@pytest.fixture(scope="module")
def admin_user():
    email = f"TEST_admin_{uuid.uuid4().hex[:8]}@t.com"
    data = _signup(email, "AdminPw0!")
    token = data["access_token"]
    user_id = data["user"]["id"]
    _created_user_ids.append(user_id)
    db.users.update_one({"id": user_id}, {"$set": {"is_admin": True, "team_access": True}})
    # NB: JWT payload has no is_admin field — server re-reads user_doc each request, so mongo flip is enough.
    return {"token": token, "user_id": user_id, "email": email}


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    for uid in _created_user_ids:
        db.entitlements.delete_many({"user_id": uid})
        db.entitlement_events.delete_many({"user_id": uid})
        db.lifetime_codes.delete_many({"redeemed_by_user_id": uid})
        db.lifetime_codes.delete_many({"created_by_admin_id": uid})
        h = db.households.find_one({"member_user_ids": uid})
        if h:
            db.households.delete_one({"id": h["id"]})
        db.athletes.delete_many({"user_id": uid})
        db.roster.delete_many({"user_id": uid})
        db.signup_sheets.delete_many({"user_id": uid})
        db.attendance_sessions.delete_many({"user_id": uid})
        db.paperwork_sheets.delete_many({"user_id": uid})
        db.payment_trackers.delete_many({"user_id": uid})
        db.share_links.delete_many({"user_id": uid})
        db.roster_columns.delete_many({"user_id": uid})
        db.size_sheets.delete_many({"user_id": uid})
        db.users.delete_one({"id": uid})


# ==================================================================
# Entitlements & Premium status
# ==================================================================
class TestEntitlements:
    def test_config_shape(self, premium_user):
        r = _get("/api/entitlements/config", premium_user["token"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert "limits" in body and "pricing" in body
        assert body["limits"]["free"]["team_hub_athletes"] == 36
        assert body["limits"]["free"]["team_hub_personnel"] == 4
        assert body["limits"]["premium"]["household_members"] == 6
        assert "sizes" in body["premium_team_hub_features"]
        assert body["pricing"]["currency"] == "USD"

    def test_me_free_default(self, free_team_user):
        r = _get("/api/entitlements/me", free_team_user["token"])
        assert r.status_code == 200
        b = r.json()
        assert b["is_premium"] is False and b["plan"] == "free"

    def test_me_premium_review(self, premium_user):
        r = _get("/api/entitlements/me", premium_user["token"])
        assert r.status_code == 200
        b = r.json()
        assert b["is_premium"] is True
        assert b["plan"] == "lifetime"

    def test_premium_status_endpoint(self, free_team_user, premium_user):
        r1 = _get("/api/premium/status", free_team_user["token"])
        assert r1.status_code == 200 and r1.json()["is_premium"] is False
        r2 = _get("/api/premium/status", premium_user["token"])
        assert r2.status_code == 200 and r2.json()["is_premium"] is True


# ==================================================================
# Admin gating + admin flows
# ==================================================================
class TestAdmin:
    def test_non_admin_403(self, free_team_user):
        r = _get("/api/admin/status", free_team_user["token"])
        assert r.status_code == 403

    def test_admin_200(self, admin_user):
        r = _get("/api/admin/status", admin_user["token"])
        assert r.status_code == 200 and r.json()["is_admin"] is True

    def test_generate_and_list_codes_no_hash_leak(self, admin_user):
        r = _post("/api/admin/codes/generate", admin_user["token"], json={"count": 2, "label": "TEST_iter73"})
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        assert len(created) == 2 and all("code" in c and len(c["code"]) >= 10 for c in created)
        # list should hide code_hash
        rl = _get("/api/admin/codes", admin_user["token"])
        assert rl.status_code == 200
        codes = rl.json()["codes"]
        assert all("code_hash" not in c for c in codes)
        assert any(c["id"] == created[0]["id"] for c in codes)

    def test_disable_prevents_redeem(self, admin_user):
        r = _post("/api/admin/codes/generate", admin_user["token"], json={"count": 1, "label": "TEST_disable"})
        c = r.json()["created"][0]
        rd = _post(f"/api/admin/codes/{c['id']}/disable", admin_user["token"])
        assert rd.status_code == 200
        # signup a fresh user to try redemption
        u = _signup(f"TEST_red_{uuid.uuid4().hex[:6]}@t.com", "Passw0rd!")
        _created_user_ids.append(u["user"]["id"])
        rr = _post("/api/premium/redeem", u["access_token"], json={"code": c["code"]})
        assert rr.status_code == 400

    def test_self_premium_toggle(self, admin_user):
        r_on = _post("/api/admin/self-premium-toggle", admin_user["token"], json={"enabled": True})
        assert r_on.status_code == 200 and r_on.json()["enabled"] is True
        r_st = _get("/api/entitlements/me", admin_user["token"])
        assert r_st.json()["is_premium"] is True
        r_off = _post("/api/admin/self-premium-toggle", admin_user["token"], json={"enabled": False})
        assert r_off.status_code == 200 and r_off.json()["enabled"] is False
        r_st2 = _get("/api/entitlements/me", admin_user["token"])
        assert r_st2.json()["is_premium"] is False

    def test_lifetime_grant_and_revoke(self, admin_user):
        # target: a fresh free user
        target = _signup(f"TEST_target_{uuid.uuid4().hex[:6]}@t.com", "Passw0rd!")
        target_uid = target["user"]["id"]
        _created_user_ids.append(target_uid)

        rg = _post("/api/admin/lifetime/grant", admin_user["token"], json={"user_id": target_uid, "label": "TEST_grant"})
        assert rg.status_code == 200, rg.text
        ent_id = rg.json()["entitlement_id"]
        # confirm resolves premium
        rs = _get("/api/entitlements/me", target["access_token"])
        assert rs.json()["is_premium"] is True and rs.json()["plan"] == "lifetime"
        # search returns premium
        rq = _get(f"/api/admin/users/search?q={target['user']['email']}", admin_user["token"])
        assert rq.status_code == 200
        res = rq.json()["results"]
        assert len(res) >= 1 and res[0]["premium"]["is_premium"] is True
        # revoke
        rr = _post("/api/admin/lifetime/revoke", admin_user["token"], json={"entitlement_id": ent_id})
        assert rr.status_code == 200
        rs2 = _get("/api/entitlements/me", target["access_token"])
        assert rs2.json()["is_premium"] is False


# ==================================================================
# Code redemption (invalid, valid, re-use, rate-limit)
# ==================================================================
class TestRedeem:
    def test_invalid_400(self, free_team_user):
        r = _post("/api/premium/redeem", free_team_user["token"], json={"code": "NOSUCHCODE12"})
        assert r.status_code == 400

    def test_valid_then_re_redeem(self, admin_user):
        # generate code
        gen = _post("/api/admin/codes/generate", admin_user["token"], json={"count": 1, "label": "TEST_valid"})
        code = gen.json()["created"][0]["code"]
        # fresh user
        u = _signup(f"TEST_rv_{uuid.uuid4().hex[:6]}@t.com", "Passw0rd!")
        _created_user_ids.append(u["user"]["id"])
        r1 = _post("/api/premium/redeem", u["access_token"], json={"code": code})
        assert r1.status_code == 200, r1.text
        assert r1.json()["redeemed"] is True and r1.json()["plan"] == "lifetime"
        # premium resolves
        assert _get("/api/entitlements/me", u["access_token"]).json()["is_premium"] is True
        # re-redeem (already-used) → generic 400
        r2 = _post("/api/premium/redeem", u["access_token"], json={"code": code})
        assert r2.status_code == 400

    def test_rate_limit_5_per_min(self):
        u = _signup(f"TEST_rl_{uuid.uuid4().hex[:6]}@t.com", "Passw0rd!")
        _created_user_ids.append(u["user"]["id"])
        codes_tried = ["BADCODE00000", "BADCODE00001", "BADCODE00002", "BADCODE00003",
                       "BADCODE00004", "BADCODE00005", "BADCODE00006"]
        statuses = [
            _post("/api/premium/redeem", u["access_token"], json={"code": c}).status_code
            for c in codes_tried
        ]
        # First 5 should be 400 (invalid); 6th+ should be 429 (rate-limited).
        assert 429 in statuses, f"Expected 429 in rate-limited attempts: {statuses}"


# ==================================================================
# Team Hub gating — FREE user
# ==================================================================
class TestFreeGating:
    def test_sizes_column_gated(self, free_team_user):
        r = _post("/api/team/sizes/columns", free_team_user["token"], json={"label": "TEST_col"})
        assert r.status_code == 402
        assert "premium_required:sizes" in r.text

    def test_sizes_value_gated(self, free_team_user):
        r = requests.put(
            f"{BASE_URL}/api/team/sizes/value",
            headers={"Authorization": f"Bearer {free_team_user['token']}"},
            json={"member_id": "x", "column_id": "y", "value": "L"},
        )
        assert r.status_code == 402

    def test_paperwork_create_gated(self, free_team_user):
        r = _post("/api/team/paperwork", free_team_user["token"], json={"name": "TEST_pw"})
        assert r.status_code == 402
        assert "premium_required:paperwork" in r.text

    def test_team_payment_create_gated(self, free_team_user):
        r = _post("/api/team/payments", free_team_user["token"], json={"name": "TEST_tracker"})
        assert r.status_code == 402
        assert "premium_required:team_payments" in r.text

    def test_share_link_gated(self, free_team_user):
        r = _post("/api/team/share", free_team_user["token"], json={"kind": "roster"})
        assert r.status_code == 402
        assert "premium_required:parent_share_links" in r.text

    def test_roster_custom_col_gated(self, free_team_user):
        r = _post("/api/roster/columns", free_team_user["token"], json={"label": "TEST_col"})
        assert r.status_code == 402
        assert "premium_required:roster_custom_columns" in r.text

    def test_second_signup_and_attendance_gated(self, free_team_user):
        # First signup sheet allowed
        r1 = _post("/api/team/signups", free_team_user["token"], json={"name": "TEST_signup_1"})
        assert r1.status_code == 200, r1.text
        r2 = _post("/api/team/signups", free_team_user["token"], json={"name": "TEST_signup_2"})
        assert r2.status_code == 402 and "limit_reached:team_hub_signup_sheets" in r2.text
        # First attendance allowed
        a1 = _post("/api/team/attendance", free_team_user["token"], json={"title": "TEST_att_1"})
        assert a1.status_code == 200
        a2 = _post("/api/team/attendance", free_team_user["token"], json={"title": "TEST_att_2"})
        assert a2.status_code == 402 and "limit_reached:team_hub_attendance_sessions" in a2.text

    def test_personnel_and_athlete_count_caps(self, free_team_user):
        tok = free_team_user["token"]
        # personnel: 4 allowed then 402
        for i in range(4):
            r = _post("/api/roster", tok, json={"name": f"TEST_p{i}", "role": "coach"})
            assert r.status_code == 200, f"personnel {i}: {r.status_code} {r.text}"
        r5 = _post("/api/roster", tok, json={"name": "TEST_p5", "role": "coach"})
        assert r5.status_code == 402 and "limit_reached:team_hub_personnel" in r5.text

        # athletes: create up to 36; do a spot check with first 3 and skip the middle by direct mongo insert to speed up (still counts)
        # We insert 33 directly through mongo, then 3 via API to cover the branch.
        h = db.households.find_one({"member_user_ids": free_team_user["user_id"]})
        member_ids = h.get("member_user_ids") or []
        # 3 via API
        for i in range(3):
            r = _post("/api/roster", tok, json={"name": f"TEST_a{i}", "role": "athlete"})
            assert r.status_code == 200
        # 33 via direct insert to reach 36 (roster collection is `db.roster`)
        for i in range(33):
            db.roster.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": free_team_user["user_id"],
                "name": f"TEST_bulk_a{i}",
                "role": "athlete",
                "team_ids": [],
                "created_at": "2026-01-01T00:00:00Z",
            })
        # 37th athlete → 402
        r_over = _post("/api/roster", tok, json={"name": "TEST_a_over", "role": "athlete"})
        assert r_over.status_code == 402, f"Expected 402 at cap, got {r_over.status_code}: {r_over.text}"
        assert "limit_reached:team_hub_athletes" in r_over.text

    def test_spreadsheet_import_gated(self, free_team_user):
        # POST /api/import/preview with a team kind should 402
        files = {"file": ("roster.csv", b"name,role\nFoo,athlete\n", "text/csv")}
        data = {"kind": "roster"}
        r = requests.post(
            f"{BASE_URL}/api/import/preview",
            headers={"Authorization": f"Bearer {free_team_user['token']}"},
            files=files, data=data,
        )
        assert r.status_code == 402, f"{r.status_code}: {r.text}"


# ==================================================================
# Team Hub gating — PREMIUM (applereview) — no gating
# ==================================================================
class TestPremiumOpen:
    def test_premium_sizes_column(self, premium_user):
        r = _post("/api/team/sizes/columns", premium_user["token"], json={"label": "TEST_prem_col"})
        assert r.status_code == 200, r.text
        # cleanup: remove that column
        col_id = next((c["id"] for c in r.json().get("columns", []) if c.get("label") == "TEST_prem_col"), None)
        if col_id:
            _delete(f"/api/team/sizes/columns/{col_id}", premium_user["token"])

    def test_premium_paperwork_create(self, premium_user):
        r = _post("/api/team/paperwork", premium_user["token"], json={"name": "TEST_prem_pw"})
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        _delete(f"/api/team/paperwork/{sid}", premium_user["token"])

    def test_premium_payments_create(self, premium_user):
        r = _post("/api/team/payments", premium_user["token"], json={"name": "TEST_prem_tracker"})
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        _delete(f"/api/team/payments/{tid}", premium_user["token"])

    def test_premium_share_link(self, premium_user):
        r = _post("/api/team/share", premium_user["token"], json={"kind": "roster"})
        assert r.status_code == 200, r.text
        # cleanup
        link_id = r.json().get("id")
        if link_id:
            _delete(f"/api/team/share/{link_id}", premium_user["token"])


# ==================================================================
# Regression: applereview Team Hub still works & remains Lifetime
# ==================================================================
class TestRegression:
    def test_apple_review_lifetime_intact(self, premium_user):
        r = _get("/api/entitlements/me", premium_user["token"])
        b = r.json()
        assert b["is_premium"] is True and b["plan"] == "lifetime"
        # verify source is admin_grant (not test toggle)
        uid = premium_user["user"]["id"]
        ent = db.entitlements.find_one({"user_id": uid, "type": "lifetime", "status": "active"})
        assert ent is not None
        assert ent.get("source") == "admin_grant", f"Expected admin_grant source, got {ent.get('source')}"

    def test_team_access_get(self, premium_user):
        r = _get("/api/team-access", premium_user["token"])
        assert r.status_code == 200
        body = r.json()
        assert "members" in body
        assert "collaborators" in body  # NEW decoupling
        assert isinstance(body["collaborators"], list)

    def test_roster_and_sizes_read(self, premium_user):
        assert _get("/api/roster", premium_user["token"]).status_code == 200
        assert _get("/api/team/sizes", premium_user["token"]).status_code == 200
        assert _get("/api/team/paperwork", premium_user["token"]).status_code == 200
        assert _get("/api/team/payments", premium_user["token"]).status_code == 200
        assert _get("/api/todos", premium_user["token"]).status_code == 200


# ==================================================================
# Household/TeamHub decoupling: team-access invite goes to team_hub_member_user_ids
# ==================================================================
class TestDecoupling:
    def test_team_hub_invite_no_household_seat(self, premium_user):
        # applereview creates a team-access invite
        r = _post("/api/team-access/invite", premium_user["token"], json={"email": f"TEST_col_{uuid.uuid4().hex[:6]}@t.com"})
        assert r.status_code == 200, r.text
        code = r.json().get("code")
        assert code, r.text

        # fresh user joins with that code
        joiner = _signup(f"TEST_join_{uuid.uuid4().hex[:6]}@t.com", "Passw0rd!")
        joiner_uid = joiner["user"]["id"]
        _created_user_ids.append(joiner_uid)
        rj = _post("/api/household/join", joiner["access_token"], json={"code": code})
        assert rj.status_code == 200, rj.text
        body = rj.json()
        assert body.get("collaborator") is True
        assert body.get("team_access") is True

        # verify mongo: joiner IS NOT in member_user_ids but IS in team_hub_member_user_ids
        prem_hid = db.households.find_one({"member_user_ids": premium_user["user"]["id"]})["id"]
        h = db.households.find_one({"id": prem_hid})
        assert joiner_uid not in h.get("member_user_ids", [])
        assert joiner_uid in h.get("team_hub_member_user_ids", [])
        # cleanup: remove joiner from team_hub_member_user_ids
        db.households.update_one({"id": prem_hid}, {"$pull": {"team_hub_member_user_ids": joiner_uid}})
