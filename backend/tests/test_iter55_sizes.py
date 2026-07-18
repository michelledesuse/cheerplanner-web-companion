"""Tests for Team Hub — Sizes tool (iteration 55).

Covers:
- GET /api/team/sizes idempotent creation with 8 default columns
- POST /api/team/sizes/columns adds a custom column (empty label -> 400)
- PATCH renames a column; unknown id -> 404
- DELETE removes column and strips values from all members
- PUT /api/team/sizes/value: valid set, empty clears, unknown member -> 404,
  unknown column -> 404, persistence in sheet.values[member_id][column_id]
"""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"

DEFAULTS = ["Shirt", "Tank", "Sports bra", "Shorts", "Shoes", "Sweatshirt", "Jacket", "Ring"]


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def test_member(api_client):
    """Create a temporary athlete roster member for value tests. Cleaned up at end."""
    name = f"TEST_Sizes_{uuid.uuid4().hex[:6]}"
    r = api_client.post(f"{BASE_URL}/api/roster", json={
        "first_name": name, "last_name": "Athlete", "role": "athlete",
    })
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    yield mid
    api_client.delete(f"{BASE_URL}/api/roster/{mid}")


# ---------- Sheet ----------
class TestSizesSheet:
    def test_get_creates_sheet_with_defaults(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/team/sizes")
        assert r.status_code == 200, r.text
        sheet = r.json()
        assert "id" in sheet
        assert "columns" in sheet and isinstance(sheet["columns"], list)
        labels = [c["label"] for c in sheet["columns"]]
        # All 8 defaults present, in any order (order field controls display).
        for d in DEFAULTS:
            assert d in labels, f"Missing default column: {d}. Got: {labels}"
        # All 8 defaults have is_default=True
        for c in sheet["columns"]:
            if c["label"] in DEFAULTS:
                assert c["is_default"] is True

    def test_get_is_idempotent(self, api_client):
        r1 = api_client.get(f"{BASE_URL}/api/team/sizes")
        r2 = api_client.get(f"{BASE_URL}/api/team/sizes")
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"], "Sheet id changed - not idempotent"


# ---------- Columns ----------
class TestColumns:
    def test_add_column_empty_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/team/sizes/columns", json={"label": "   "})
        assert r.status_code == 400

    def test_add_custom_column(self, api_client):
        label = f"TEST_Custom_{uuid.uuid4().hex[:5]}"
        r = api_client.post(f"{BASE_URL}/api/team/sizes/columns", json={"label": label})
        assert r.status_code == 200, r.text
        sheet = r.json()
        added = [c for c in sheet["columns"] if c["label"] == label]
        assert len(added) == 1
        assert added[0]["is_default"] is False
        # Order should be max+1
        orders = [c["order"] for c in sheet["columns"]]
        assert added[0]["order"] == max(orders)
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/team/sizes/columns/{added[0]['id']}")

    def test_rename_column(self, api_client):
        # Create then rename
        r = api_client.post(f"{BASE_URL}/api/team/sizes/columns", json={"label": "TEST_Rename_orig"})
        cid = [c for c in r.json()["columns"] if c["label"] == "TEST_Rename_orig"][0]["id"]
        r2 = api_client.patch(f"{BASE_URL}/api/team/sizes/columns/{cid}", json={"label": "TEST_Rename_new"})
        assert r2.status_code == 200, r2.text
        labels = [c["label"] for c in r2.json()["columns"] if c["id"] == cid]
        assert labels == ["TEST_Rename_new"]
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/team/sizes/columns/{cid}")

    def test_rename_unknown_column_404(self, api_client):
        r = api_client.patch(f"{BASE_URL}/api/team/sizes/columns/nonexistent-id",
                             json={"label": "Zzz"})
        assert r.status_code == 404

    def test_delete_column_strips_values(self, api_client, test_member):
        # Add temp column
        r = api_client.post(f"{BASE_URL}/api/team/sizes/columns", json={"label": "TEST_ToDelete"})
        cid = [c for c in r.json()["columns"] if c["label"] == "TEST_ToDelete"][0]["id"]
        # Set a value
        rv = api_client.put(f"{BASE_URL}/api/team/sizes/value",
                            json={"member_id": test_member, "column_id": cid, "value": "AL"})
        assert rv.status_code == 200
        assert rv.json()["values"].get(test_member, {}).get(cid) == "AL"
        # Delete the column
        rd = api_client.delete(f"{BASE_URL}/api/team/sizes/columns/{cid}")
        assert rd.status_code == 200
        sheet = rd.json()
        assert cid not in [c["id"] for c in sheet["columns"]]
        # Value should be stripped for that column across all members
        for mid, vals in (sheet.get("values") or {}).items():
            assert cid not in vals, f"Column value not stripped for member {mid}"


# ---------- Values ----------
class TestValues:
    def _first_default_col_id(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/team/sizes")
        return r.json()["columns"][0]["id"]

    def test_set_and_persist_value(self, api_client, test_member):
        cid = self._first_default_col_id(api_client)
        r = api_client.put(f"{BASE_URL}/api/team/sizes/value",
                           json={"member_id": test_member, "column_id": cid, "value": "YM"})
        assert r.status_code == 200
        assert r.json()["values"][test_member][cid] == "YM"
        # Verify persistence via a fresh GET
        g = api_client.get(f"{BASE_URL}/api/team/sizes")
        assert g.json()["values"][test_member][cid] == "YM"

    def test_empty_value_clears_cell(self, api_client, test_member):
        cid = self._first_default_col_id(api_client)
        # Ensure it has a value first
        api_client.put(f"{BASE_URL}/api/team/sizes/value",
                       json={"member_id": test_member, "column_id": cid, "value": "AL"})
        # Clear it
        r = api_client.put(f"{BASE_URL}/api/team/sizes/value",
                           json={"member_id": test_member, "column_id": cid, "value": ""})
        assert r.status_code == 200
        vals = r.json()["values"].get(test_member, {})
        assert cid not in vals

    def test_unknown_member_404(self, api_client):
        cid = self._first_default_col_id(api_client)
        r = api_client.put(f"{BASE_URL}/api/team/sizes/value",
                           json={"member_id": "nonexistent-member", "column_id": cid, "value": "M"})
        assert r.status_code == 404

    def test_unknown_column_404(self, api_client, test_member):
        r = api_client.put(f"{BASE_URL}/api/team/sizes/value",
                           json={"member_id": test_member, "column_id": "nonexistent-col", "value": "M"})
        assert r.status_code == 404
