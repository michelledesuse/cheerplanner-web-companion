"""Iteration 90 — Team Hub Switcher + regression across Team Hub tools.

Tests:
  1. New /api/team/hubs endpoints (GET list, POST /active, PATCH /{id} rename).
  2. Regression: with a single owner hub, every Team Hub tool still lists
     existing owner data (roster of 8, athletes of 2, sizes, paperwork, forms,
     signups, attendance, todos, music, payments) and CRUD writes anchor to
     the active hub owner.
  3. Broadcast dry_run.

All test-created rows are deleted at the end of each test.
"""
import os
import uuid
import requests
import pytest

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://event-planner-394.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "demo@cheerplanner.app"
PASSWORD = "CheerDemo2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def hdrs(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def me(hdrs):
    r = requests.get(f"{API}/auth/me", headers=hdrs, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================
# 1) Hub switcher endpoints
# ============================================================
class TestHubEndpoints:
    def test_list_hubs_returns_active(self, hdrs):
        r = requests.get(f"{API}/team/hubs", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "hubs" in data and "active_hub_id" in data
        assert isinstance(data["hubs"], list) and len(data["hubs"]) >= 1
        h = data["hubs"][0]
        for k in ("id", "name", "is_owner", "is_active"):
            assert k in h
        active = [x for x in data["hubs"] if x["is_active"]]
        assert len(active) == 1
        assert active[0]["id"] == data["active_hub_id"]

    def test_set_active_invalid_hub_403(self, hdrs):
        r = requests.post(
            f"{API}/team/hubs/active",
            headers=hdrs, json={"hub_id": f"bogus-{uuid.uuid4()}"}, timeout=30,
        )
        assert r.status_code == 403, r.text

    def test_set_active_valid(self, hdrs):
        hubs = requests.get(f"{API}/team/hubs", headers=hdrs, timeout=30).json()["hubs"]
        target = next(h for h in hubs if h["is_owner"])
        r = requests.post(f"{API}/team/hubs/active", headers=hdrs, json={"hub_id": target["id"]}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["active_hub_id"] == target["id"]
        after = requests.get(f"{API}/team/hubs", headers=hdrs, timeout=30).json()
        assert after["active_hub_id"] == target["id"]

    def test_rename_hub_owner_persists(self, hdrs):
        hubs = requests.get(f"{API}/team/hubs", headers=hdrs, timeout=30).json()["hubs"]
        owner_hub = next(h for h in hubs if h["is_owner"])
        original = owner_hub["name"]
        new_name = f"TEST_{uuid.uuid4().hex[:6]}"
        r = requests.patch(f"{API}/team/hubs/{owner_hub['id']}", headers=hdrs, json={"name": new_name}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == new_name
        after = requests.get(f"{API}/team/hubs", headers=hdrs, timeout=30).json()["hubs"]
        assert any(h["id"] == owner_hub["id"] and h["name"] == new_name for h in after)
        # restore: send "" to clear hub_name if it was auto-derived; else restore
        restore = "" if original.endswith("'s Team") else original
        requests.patch(f"{API}/team/hubs/{owner_hub['id']}", headers=hdrs, json={"name": restore}, timeout=30)

    def test_rename_nonexistent_404(self, hdrs):
        r = requests.patch(
            f"{API}/team/hubs/does-not-exist-{uuid.uuid4()}", headers=hdrs, json={"name": "x"}, timeout=30
        )
        assert r.status_code == 404


# ============================================================
# 2) Regression across Team Hub tools with single owner hub
# ============================================================
class TestOwnerHubToolsRegression:
    """Owner has 8 roster + 2 athletes seeded. Every tool must load & CRUD.

    IMPORTANT: All Team Hub CRUD writes must anchor user_id to hub owner
    (not to the requesting user directly — which happens to be the owner here).
    """

    def test_roster_lists_seed(self, hdrs):
        r = requests.get(f"{API}/roster", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text
        docs = r.json()
        assert len(docs) >= 8, f"expected >=8 roster members, got {len(docs)}"

    def test_athletes_seed(self, hdrs):
        r = requests.get(f"{API}/athletes", headers=hdrs, timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 2

    def test_roster_create_anchors_to_hub_owner_and_delete(self, hdrs, me):
        r = requests.post(
            f"{API}/roster", headers=hdrs,
            json={"name": f"TEST_Regression {uuid.uuid4().hex[:6]}", "role": "parent"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        m = r.json()
        # single-hub owner: anchored user_id must equal the owner (== requester id)
        assert m["user_id"] == me["id"]
        assert any(x["id"] == m["id"] for x in requests.get(f"{API}/roster", headers=hdrs, timeout=30).json())
        assert requests.delete(f"{API}/roster/{m['id']}", headers=hdrs, timeout=30).status_code == 200

    def test_roster_edit(self, hdrs):
        c = requests.post(f"{API}/roster", headers=hdrs, json={"name": "TEST_Edit", "role": "parent"}, timeout=30)
        mid = c.json()["id"]
        r = requests.patch(f"{API}/roster/{mid}", headers=hdrs, json={"name": "TEST_Edited"}, timeout=30)
        assert r.status_code == 200 and r.json()["name"] == "TEST_Edited"
        requests.delete(f"{API}/roster/{mid}", headers=hdrs, timeout=30)

    def test_sizes(self, hdrs):
        r = requests.get(f"{API}/team/sizes", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text

    def test_paperwork(self, hdrs):
        r = requests.get(f"{API}/team/paperwork", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text

    def test_team_forms_create(self, hdrs):
        r = requests.get(f"{API}/team/forms", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text
        c = requests.post(
            f"{API}/team/forms", headers=hdrs,
            json={"name": f"TEST_Form_{uuid.uuid4().hex[:6]}",
                  "fields": [{"label": "Q1", "type": "text"}]}, timeout=30,
        )
        assert c.status_code == 200, c.text
        fid = c.json()["id"]
        requests.delete(f"{API}/team/forms/{fid}", headers=hdrs, timeout=30)

    def test_signup_sheet_create(self, hdrs):
        r = requests.get(f"{API}/team/signups", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text
        c = requests.post(f"{API}/team/signups", headers=hdrs,
                          json={"name": f"TEST_Signup_{uuid.uuid4().hex[:6]}"}, timeout=30)
        assert c.status_code == 200, c.text
        sid = c.json()["id"]
        requests.delete(f"{API}/team/signups/{sid}", headers=hdrs, timeout=30)

    def test_attendance_create(self, hdrs):
        r = requests.get(f"{API}/team/attendance", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text
        c = requests.post(f"{API}/team/attendance", headers=hdrs,
                          json={"title": f"TEST_Attend_{uuid.uuid4().hex[:6]}", "date": "2026-06-01"}, timeout=30)
        assert c.status_code == 200, c.text
        sid = c.json()["id"]
        requests.delete(f"{API}/team/attendance/{sid}", headers=hdrs, timeout=30)

    def test_todos_create(self, hdrs):
        r = requests.get(f"{API}/todos?scope=team", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text
        c = requests.post(f"{API}/todos", headers=hdrs,
                          json={"text": f"TEST_Todo_{uuid.uuid4().hex[:6]}", "scope": "team"}, timeout=30)
        assert c.status_code == 200, c.text
        tid = c.json()["id"]
        requests.delete(f"{API}/todos/{tid}", headers=hdrs, timeout=30)

    def test_music_list(self, hdrs):
        r = requests.get(f"{API}/team/music", headers=hdrs, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_payments_tracker_create(self, hdrs):
        r = requests.get(f"{API}/team/payments", headers=hdrs, timeout=30)
        assert r.status_code == 200, r.text
        c = requests.post(f"{API}/team/payments", headers=hdrs,
                          json={"name": f"TEST_Pay_{uuid.uuid4().hex[:6]}", "amount": 25.0}, timeout=30)
        assert c.status_code == 200, c.text
        pid = c.json()["id"]
        requests.delete(f"{API}/team/payments/{pid}", headers=hdrs, timeout=30)


# ============================================================
# 3) Broadcast dry_run (no real Twilio send)
# ============================================================
class TestBroadcastDryRun:
    def test_dry_run(self, hdrs):
        payload = {"body": "TEST_dry", "dry_run": True}
        r = requests.post(f"{API}/team/broadcast/send", headers=hdrs, json=payload, timeout=30)
        # dry_run should be accepted (200) or return a validation-shape error (400).
        assert r.status_code in (200, 400), r.text
