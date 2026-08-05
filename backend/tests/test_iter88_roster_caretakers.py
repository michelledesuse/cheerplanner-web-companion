"""CheerPlanner 2.0 — Roster caretakers, DOB, adult_athlete
Backend tests for roster CRUD, broadcast recipient extraction (dry_run),
and public share submit round-trip.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASSWORD = "CheerDemo2026!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_member_ids(auth_headers):
    """Track created members so we can clean up."""
    ids = []
    yield ids
    for mid in ids:
        try:
            requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=auth_headers, timeout=15)
        except Exception:
            pass


# ---------- Roster CRUD ----------
class TestRosterCRUDNewFields:
    def test_create_athlete_with_new_fields(self, auth_headers, created_member_ids):
        payload = {
            "first_name": "TEST_Ava",
            "last_name": "Rossi",
            "role": "athlete",
            "phone": "+15555550100",
            "dob": "05/12/2008",
            "adult_athlete": True,
            "parent_first_name": "Jane",
            "parent_last_name": "Rossi",
            "parent_relationship": "Mother",
            "parent_phone": "+15555550101",
            "parent_email": "jane@example.com",
            "parent_include_in_texts": True,
            "caretakers": [
                {"first_name": "John", "last_name": "Rossi", "relationship": "Father",
                 "phone": "+15555550102", "email": "john@example.com", "include_in_texts": True},
                {"first_name": "Ann", "last_name": "Rossi", "relationship": "Grandparent",
                 "phone": "+15555550103", "include_in_texts": False},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/roster", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, f"POST /api/roster: {r.status_code} {r.text}"
        m = r.json()
        created_member_ids.append(m["id"])
        assert m["dob"] == "05/12/2008"
        assert m["adult_athlete"] is True
        assert m["parent_relationship"] == "Mother"
        assert m["parent_include_in_texts"] is True
        assert len(m["caretakers"]) == 2
        assert m["caretakers"][0]["relationship"] == "Father"
        assert m["caretakers"][0]["include_in_texts"] is True
        assert m["caretakers"][1]["include_in_texts"] is False

    def test_get_returns_new_fields(self, auth_headers, created_member_ids):
        assert created_member_ids, "prior test must succeed"
        r = requests.get(f"{BASE_URL}/api/roster", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        doc = next((x for x in r.json() if x["id"] == created_member_ids[0]), None)
        assert doc is not None
        assert doc["dob"] == "05/12/2008"
        assert doc["adult_athlete"] is True
        assert len(doc["caretakers"]) == 2

    def test_patch_updates_caretakers(self, auth_headers, created_member_ids):
        mid = created_member_ids[0]
        patch = {
            "dob": "06/01/2007",
            "adult_athlete": False,
            "parent_include_in_texts": False,
            "caretakers": [
                {"first_name": "New", "last_name": "Only", "relationship": "Guardian",
                 "phone": "+15555550199", "include_in_texts": True},
            ],
        }
        r = requests.patch(f"{BASE_URL}/api/roster/{mid}", json=patch, headers=auth_headers, timeout=15)
        assert r.status_code == 200, f"PATCH: {r.status_code} {r.text}"
        m = r.json()
        assert m["dob"] == "06/01/2007"
        assert m["adult_athlete"] is False
        assert m["parent_include_in_texts"] is False
        assert len(m["caretakers"]) == 1
        assert m["caretakers"][0]["first_name"] == "New"

    def test_patch_empty_caretakers_clears(self, auth_headers, created_member_ids):
        mid = created_member_ids[0]
        r = requests.patch(f"{BASE_URL}/api/roster/{mid}", json={"caretakers": []},
                           headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["caretakers"] == []


# ---------- Broadcast recipient extraction ----------
class TestBroadcastRecipients:
    @pytest.fixture(scope="class")
    def scenario_member(self, auth_headers):
        payload = {
            "first_name": "TEST_Bcast",
            "last_name": "Athlete",
            "role": "athlete",
            "phone": "+15555560000",           # athlete's own phone
            "adult_athlete": True,
            "parent_first_name": "Mom",
            "parent_phone": "+15555560001",
            "parent_relationship": "Mother",
            "parent_include_in_texts": True,
            "caretakers": [
                {"first_name": "Dad", "relationship": "Father", "phone": "+15555560002", "include_in_texts": True},
                {"first_name": "Aunt", "relationship": "Other", "phone": "+15555560003", "include_in_texts": False},
                {"first_name": "Dup", "relationship": "Other", "phone": "+15555560001", "include_in_texts": True},  # dup of parent
            ],
        }
        r = requests.post(f"{BASE_URL}/api/roster", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        mid = r.json()["id"]
        yield mid
        requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=auth_headers, timeout=15)

    def test_dry_run_includes_expected_recipients(self, auth_headers, scenario_member):
        payload = {
            "message": "Test",
            "recipients": {"mode": "members", "member_ids": [scenario_member]},
            "base_url": BASE_URL,
            "dry_run": True,
        }
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send", json=payload, headers=auth_headers, timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        preview = data.get("preview", [])
        phones = {p["phone"] for p in preview}
        # Twilio-masked "•••• last4". Extract last4 digits.
        last4 = {p["phone"][-4:] for p in preview}
        # Expected: parent 0001, athlete 0000, caretaker Dad 0002. Not Aunt (excluded). Dup deduped.
        assert "0001" in last4, f"Parent phone missing. Got last4={last4}"
        assert "0000" in last4, f"Adult athlete own phone missing. Got last4={last4}"
        assert "0002" in last4, f"Caretaker Dad phone missing. Got last4={last4}"
        assert "0003" not in last4, f"Excluded caretaker Aunt should NOT be present. Got last4={last4}"
        # Dedup: 3 unique recipients
        assert data["recipient_count"] == 3, f"Expected 3 unique recipients, got {data['recipient_count']} (phones={phones})"

    def test_dry_run_respects_parent_include_false(self, auth_headers):
        # Create a member with parent_include_in_texts=False and adult_athlete=False
        payload = {
            "first_name": "TEST_NoParent",
            "last_name": "Athlete",
            "role": "athlete",
            "phone": "+15555561000",
            "adult_athlete": False,
            "parent_phone": "+15555561001",
            "parent_include_in_texts": False,
            "caretakers": [
                {"first_name": "Only", "phone": "+15555561002", "include_in_texts": True},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/roster", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        mid = r.json()["id"]
        try:
            r2 = requests.post(f"{BASE_URL}/api/team/broadcast/send", json={
                "message": "Hi", "recipients": {"mode": "members", "member_ids": [mid]},
                "base_url": BASE_URL, "dry_run": True,
            }, headers=auth_headers, timeout=20)
            assert r2.status_code == 200, r2.text
            d = r2.json()
            last4 = {p["phone"][-4:] for p in d.get("preview", [])}
            assert "1001" not in last4, "parent_include_in_texts=False should exclude parent"
            assert "1000" not in last4, "adult_athlete=False should exclude athlete own phone"
            assert "1002" in last4, "included caretaker should be present"
            assert d["recipient_count"] == 1
        finally:
            requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=auth_headers, timeout=15)


# ---------- Public share (roster_member) — premium gated ----------
class TestPublicShareRosterMember:
    def test_share_link_creation_gated(self, auth_headers, created_member_ids):
        """Demo is FREE — expect 402/403. If premium, roundtrip the payload."""
        if not created_member_ids:
            pytest.skip("No member to share")
        mid = created_member_ids[0]
        r = requests.post(f"{BASE_URL}/api/team/share",
                          json={"kind": "roster_member", "ref_id": mid},
                          headers=auth_headers, timeout=15)
        if r.status_code in (402, 403):
            pytest.skip(f"Share link premium-gated (status {r.status_code}) — expected for FREE plan")
        assert r.status_code == 200, r.text
        token = r.json()["token"]

        # GET data — must include new fields
        r2 = requests.get(f"{BASE_URL}/api/public/share/{token}/data", timeout=15)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert "member" in d
        m = d["member"]
        for k in ("caretakers", "dob", "adult_athlete", "parent_relationship", "parent_include_in_texts"):
            assert k in m, f"Missing field in public data: {k}"

        # POST submit — new caretaker + dob should persist to roster
        submit = {
            "first_name": "TEST_Ava",
            "last_name": "Rossi",
            "role": "athlete",
            "dob": "07/07/2007",
            "adult_athlete": True,
            "parent_relationship": "Father",
            "parent_include_in_texts": False,
            "caretakers": [
                {"first_name": "Uncle", "relationship": "Guardian", "phone": "+15555550999", "include_in_texts": True},
            ],
        }
        r3 = requests.post(f"{BASE_URL}/api/public/share/{token}/submit", json=submit, timeout=15)
        assert r3.status_code == 200, r3.text

        # Verify via authed GET
        r4 = requests.get(f"{BASE_URL}/api/roster", headers=auth_headers, timeout=15)
        doc = next((x for x in r4.json() if x["id"] == mid), None)
        assert doc["dob"] == "07/07/2007"
        assert doc["adult_athlete"] is True
        assert doc["parent_relationship"] == "Father"
        assert doc["parent_include_in_texts"] is False
        assert len(doc["caretakers"]) == 1
        assert doc["caretakers"][0]["first_name"] == "Uncle"
