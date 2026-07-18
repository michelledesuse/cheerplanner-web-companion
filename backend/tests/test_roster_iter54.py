"""Backend tests for the Roster feature (Team Hub Phase C, iter 54).

Covers CRUD, validation, and the import-candidates / import endpoints.
Uses the Apple review seed account.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created_ids():
    """Track created ids to clean up at teardown."""
    ids = []
    yield ids
    # cleanup happens in the finalizer at end via a separate fixture below


# --- CRUD ------------------------------------------------------------------
class TestRosterCRUD:
    def test_list_initial(self, headers):
        r = requests.get(f"{BASE_URL}/api/roster", headers=headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_blank_name_400(self, headers):
        r = requests.post(f"{BASE_URL}/api/roster", headers=headers, json={"name": "  ", "role": "coach"}, timeout=15)
        assert r.status_code == 400

    def test_create_invalid_role_422(self, headers):
        r = requests.post(f"{BASE_URL}/api/roster", headers=headers, json={"name": "TEST_bad", "role": "wizard"}, timeout=15)
        assert r.status_code == 422

    def test_full_crud(self, headers, created_ids):
        # Create
        payload = {"name": "TEST_Coach Jamie", "role": "coach", "phone": "555-1000", "email": "coach@t.com", "notes": "hi"}
        r = requests.post(f"{BASE_URL}/api/roster", headers=headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["name"] == "TEST_Coach Jamie"
        assert m["role"] == "coach"
        assert m["phone"] == "555-1000"
        assert m["email"] == "coach@t.com"
        assert m["source"] == "manual"
        mid = m["id"]
        created_ids.append(mid)

        # List includes and is sorted by name lowercased
        r = requests.get(f"{BASE_URL}/api/roster", headers=headers, timeout=15)
        assert r.status_code == 200
        names = [x["name"] for x in r.json()]
        assert "TEST_Coach Jamie" in names
        lowered = [n.lower() for n in names]
        assert lowered == sorted(lowered)

        # Patch
        r = requests.patch(f"{BASE_URL}/api/roster/{mid}", headers=headers, json={"name": "TEST_Coach J", "role": "team_rep"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Coach J"
        assert r.json()["role"] == "team_rep"

        # 404 unknown
        r = requests.patch(f"{BASE_URL}/api/roster/does-not-exist", headers=headers, json={"name": "x"}, timeout=15)
        assert r.status_code == 404

        # Delete
        r = requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        created_ids.remove(mid)

        # 404 after delete
        r = requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=headers, timeout=15)
        assert r.status_code == 404


# --- Import ----------------------------------------------------------------
class TestRosterImport:
    def test_import_candidates_shape(self, headers):
        r = requests.get(f"{BASE_URL}/api/roster/import-candidates", headers=headers, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "athletes" in j and "members" in j
        assert isinstance(j["athletes"], list) and isinstance(j["members"], list)
        for a in j["athletes"]:
            assert "id" in a and "name" in a and "role" in a
        for m in j["members"]:
            assert "id" in m and "name" in m

    def test_import_then_dedupe(self, headers, created_ids):
        r = requests.get(f"{BASE_URL}/api/roster/import-candidates", headers=headers, timeout=15)
        assert r.status_code == 200
        cands = r.json()
        athlete_ids = [a["id"] for a in cands["athletes"]]
        member_user_ids = [m["id"] for m in cands["members"]]

        if not athlete_ids and not member_user_ids:
            pytest.skip("no candidates available in seed household")

        r = requests.post(
            f"{BASE_URL}/api/roster/import",
            headers=headers,
            json={"athlete_ids": athlete_ids, "member_user_ids": member_user_ids},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert len(created) == len(athlete_ids) + len(member_user_ids)
        for m in created:
            created_ids.append(m["id"])
            assert m["linked_id"] in (athlete_ids + member_user_ids)
            if m["source"] == "athlete":
                assert m["role"] in ("athlete", "coach", "team_rep", "staff")
            elif m["source"] == "household":
                assert m["role"] == "parent"

        # Candidates should now be empty (all imported)
        r = requests.get(f"{BASE_URL}/api/roster/import-candidates", headers=headers, timeout=15)
        j = r.json()
        assert all(a["id"] not in athlete_ids for a in j["athletes"])
        assert all(m["id"] not in member_user_ids for m in j["members"])

        # Re-import same ids → NO duplicates
        r = requests.post(
            f"{BASE_URL}/api/roster/import",
            headers=headers,
            json={"athlete_ids": athlete_ids, "member_user_ids": member_user_ids},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json() == []


# --- Teardown: clean up all TEST_ + imported rows we created ---------------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(headers, created_ids):
    yield
    # Delete anything we created
    for mid in list(created_ids):
        try:
            requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=headers, timeout=10)
        except Exception:
            pass
    # Also proactively wipe any leftover TEST_ prefixed rows from failed runs
    try:
        r = requests.get(f"{BASE_URL}/api/roster", headers=headers, timeout=10)
        if r.status_code == 200:
            for m in r.json():
                if (m.get("name") or "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/roster/{m['id']}", headers=headers, timeout=10)
    except Exception:
        pass
