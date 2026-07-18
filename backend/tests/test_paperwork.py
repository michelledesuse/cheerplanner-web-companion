"""Backend tests for CheerPlanner Team Hub — Paperwork / Other (iteration_56)."""
import os
import pytest
import requests
from dotenv import dotenv_values

# Read BASE_URL from frontend/.env (EXPO_PUBLIC_BACKEND_URL) per agent-to-agent note
_env = dotenv_values("/app/frontend/.env")
BASE_URL = (_env.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing from /app/frontend/.env"
API = f"{BASE_URL}/api"

CREDS = {"email": "applereview@cheerplanner.app", "password": "Review2026!"}


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json=CREDS, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def non_parent_member(headers):
    """Pick a non-parent roster member (create one if needed)."""
    r = requests.get(f"{API}/roster", headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    members = [m for m in r.json() if m.get("role") != "parent"]
    if not members:
        # create one
        cr = requests.post(f"{API}/roster", headers=headers, json={"name": "TEST_pp Coach", "role": "coach"}, timeout=20)
        assert cr.status_code in (200, 201), cr.text
        return cr.json()
    return members[0]


@pytest.fixture(scope="session")
def sheet(headers):
    r = requests.post(f"{API}/team/paperwork", headers=headers, json={"name": "TEST_pp Sheet"}, timeout=20)
    assert r.status_code == 200, r.text
    s = r.json()
    yield s
    requests.delete(f"{API}/team/paperwork/{s['id']}", headers=headers, timeout=20)


# ============ List / Create ============
class TestPaperworkList:
    def test_list_shape(self, headers, sheet):
        r = requests.get(f"{API}/team/paperwork", headers=headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert any(s["id"] == sheet["id"] for s in data)
        s = next(s for s in data if s["id"] == sheet["id"])
        for k in ("item_count", "member_total", "done_cells", "total_cells", "pct"):
            assert k in s["summary"], f"missing summary.{k}"
        assert isinstance(s["summary"]["member_total"], int)

    def test_create_blank_name_400(self, headers):
        r = requests.post(f"{API}/team/paperwork", headers=headers, json={"name": "   "}, timeout=20)
        assert r.status_code == 400

    def test_create_success(self, headers):
        r = requests.post(f"{API}/team/paperwork", headers=headers, json={"name": "TEST_pp Temp"}, timeout=20)
        assert r.status_code == 200
        sid = r.json()["id"]
        d = requests.delete(f"{API}/team/paperwork/{sid}", headers=headers, timeout=20)
        assert d.status_code == 200


# ============ Get / Patch / Delete sheet ============
class TestPaperworkSheetCrud:
    def test_get_unknown_404(self, headers):
        r = requests.get(f"{API}/team/paperwork/does-not-exist", headers=headers, timeout=20)
        assert r.status_code == 404

    def test_get_returns_items_values_summary(self, headers, sheet):
        r = requests.get(f"{API}/team/paperwork/{sheet['id']}", headers=headers, timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert j["id"] == sheet["id"]
        assert "items" in j and "values" in j and "summary" in j

    def test_rename_and_delete(self, headers):
        c = requests.post(f"{API}/team/paperwork", headers=headers, json={"name": "TEST_pp Renameable"}, timeout=20)
        assert c.status_code == 200
        sid = c.json()["id"]
        r = requests.patch(f"{API}/team/paperwork/{sid}", headers=headers, json={"name": "TEST_pp Renamed"}, timeout=20)
        assert r.status_code == 200
        # Verify persist
        g = requests.get(f"{API}/team/paperwork/{sid}", headers=headers, timeout=20)
        assert g.json()["name"] == "TEST_pp Renamed"
        # Rename blank -> 400
        rb = requests.patch(f"{API}/team/paperwork/{sid}", headers=headers, json={"name": " "}, timeout=20)
        assert rb.status_code == 400
        # Delete
        d = requests.delete(f"{API}/team/paperwork/{sid}", headers=headers, timeout=20)
        assert d.status_code == 200
        # Confirm 404
        g2 = requests.get(f"{API}/team/paperwork/{sid}", headers=headers, timeout=20)
        assert g2.status_code == 404
        # Delete again -> 404
        d2 = requests.delete(f"{API}/team/paperwork/{sid}", headers=headers, timeout=20)
        assert d2.status_code == 404


# ============ Items (columns) ============
class TestPaperworkItems:
    def test_add_empty_400(self, headers, sheet):
        r = requests.post(f"{API}/team/paperwork/{sheet['id']}/items", headers=headers, json={"label": " "}, timeout=20)
        assert r.status_code == 400

    def test_add_rename_delete_strips_values(self, headers, sheet, non_parent_member):
        # Add
        r = requests.post(f"{API}/team/paperwork/{sheet['id']}/items", headers=headers, json={"label": "TEST_pp Medical waiver"}, timeout=20)
        assert r.status_code == 200
        items = r.json()["items"]
        it = next(i for i in items if i["label"] == "TEST_pp Medical waiver")
        item_id = it["id"]

        # Rename
        rn = requests.patch(f"{API}/team/paperwork/{sheet['id']}/items/{item_id}", headers=headers, json={"label": "TEST_pp Waiver v2"}, timeout=20)
        assert rn.status_code == 200
        assert any(i["id"] == item_id and i["label"] == "TEST_pp Waiver v2" for i in rn.json()["items"])

        # Rename unknown -> 404
        nu = requests.patch(f"{API}/team/paperwork/{sheet['id']}/items/nope", headers=headers, json={"label": "x"}, timeout=20)
        assert nu.status_code == 404

        # Set a value so we can verify it's stripped on delete
        pv = requests.put(f"{API}/team/paperwork/{sheet['id']}/value", headers=headers,
                          json={"member_id": non_parent_member["id"], "item_id": item_id, "done": True, "note": "hello"}, timeout=20)
        assert pv.status_code == 200, pv.text
        vals = pv.json()["values"]
        assert vals[non_parent_member["id"]][item_id]["done"] is True
        assert vals[non_parent_member["id"]][item_id]["note"] == "hello"

        # Delete item
        d = requests.delete(f"{API}/team/paperwork/{sheet['id']}/items/{item_id}", headers=headers, timeout=20)
        assert d.status_code == 200
        after = d.json()
        assert all(i["id"] != item_id for i in after["items"])
        # Value stripped
        assert item_id not in (after.get("values", {}).get(non_parent_member["id"], {}) or {})


# ============ Value set (checkbox + note) ============
class TestPaperworkValue:
    def _fresh_item(self, headers, sheet_id, label="TEST_pp Signed"):
        r = requests.post(f"{API}/team/paperwork/{sheet_id}/items", headers=headers, json={"label": label}, timeout=20)
        assert r.status_code == 200
        return next(i for i in r.json()["items"] if i["label"] == label)["id"]

    def test_toggle_done_and_note(self, headers, sheet, non_parent_member):
        item_id = self._fresh_item(headers, sheet["id"], "TEST_pp Code Of Conduct")
        mid = non_parent_member["id"]

        # Set done True
        r1 = requests.put(f"{API}/team/paperwork/{sheet['id']}/value", headers=headers,
                          json={"member_id": mid, "item_id": item_id, "done": True}, timeout=20)
        assert r1.status_code == 200
        assert r1.json()["values"][mid][item_id]["done"] is True

        # Toggle done False
        r2 = requests.put(f"{API}/team/paperwork/{sheet['id']}/value", headers=headers,
                          json={"member_id": mid, "item_id": item_id, "done": False}, timeout=20)
        assert r2.json()["values"][mid][item_id]["done"] is False

        # Set note
        r3 = requests.put(f"{API}/team/paperwork/{sheet['id']}/value", headers=headers,
                          json={"member_id": mid, "item_id": item_id, "note": "  turned in Mon  "}, timeout=20)
        assert r3.status_code == 200
        assert r3.json()["values"][mid][item_id]["note"] == "turned in Mon"

        # Empty note clears
        r4 = requests.put(f"{API}/team/paperwork/{sheet['id']}/value", headers=headers,
                          json={"member_id": mid, "item_id": item_id, "note": "   "}, timeout=20)
        assert r4.status_code == 200
        assert r4.json()["values"][mid][item_id]["note"] is None

        # Persist verified via GET
        g = requests.get(f"{API}/team/paperwork/{sheet['id']}", headers=headers, timeout=20)
        cell = g.json()["values"][mid][item_id]
        assert cell["done"] is False and cell["note"] is None

    def test_value_unknown_member_404(self, headers, sheet):
        item_id = self._fresh_item(headers, sheet["id"], "TEST_pp Waiver X")
        r = requests.put(f"{API}/team/paperwork/{sheet['id']}/value", headers=headers,
                         json={"member_id": "nope-not-real", "item_id": item_id, "done": True}, timeout=20)
        assert r.status_code == 404

    def test_value_unknown_item_404(self, headers, sheet, non_parent_member):
        r = requests.put(f"{API}/team/paperwork/{sheet['id']}/value", headers=headers,
                         json={"member_id": non_parent_member["id"], "item_id": "bogus", "done": True}, timeout=20)
        assert r.status_code == 404


# ============ Summary aggregation ============
class TestPaperworkSummary:
    def test_summary_math(self, headers, non_parent_member):
        c = requests.post(f"{API}/team/paperwork", headers=headers, json={"name": "TEST_pp Summary"}, timeout=20)
        assert c.status_code == 200
        sid = c.json()["id"]
        try:
            # add 2 items
            requests.post(f"{API}/team/paperwork/{sid}/items", headers=headers, json={"label": "TEST_pp A"}, timeout=20)
            r = requests.post(f"{API}/team/paperwork/{sid}/items", headers=headers, json={"label": "TEST_pp B"}, timeout=20)
            items = r.json()["items"]
            iid = items[0]["id"]
            # Mark one done
            requests.put(f"{API}/team/paperwork/{sid}/value", headers=headers,
                         json={"member_id": non_parent_member["id"], "item_id": iid, "done": True}, timeout=20)

            g = requests.get(f"{API}/team/paperwork/{sid}", headers=headers, timeout=20)
            s = g.json()["summary"]
            assert s["item_count"] == 2
            assert s["done_cells"] >= 1
            # total_cells = items * member_total
            assert s["total_cells"] == s["item_count"] * s["member_total"]
            if s["total_cells"] > 0:
                assert s["pct"] == round(s["done_cells"] / s["total_cells"] * 100)

            # member_total excludes parents — verify against roster
            roster = requests.get(f"{API}/roster", headers=headers, timeout=20).json()
            non_parents = [m for m in roster if m.get("role") != "parent"]
            assert s["member_total"] == len(non_parents)
        finally:
            requests.delete(f"{API}/team/paperwork/{sid}", headers=headers, timeout=20)


# ============ Auth ============
class TestPaperworkAuth:
    def test_unauth_401(self):
        r = requests.get(f"{API}/team/paperwork", timeout=20)
        assert r.status_code in (401, 403)
