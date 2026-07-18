"""Tests for Team Hub — Sign-Up Sheet (iteration 57).

Covers:
- GET /api/team/signups (list + summary)
- POST /api/team/signups (blank name 400)
- GET /{id} (404 unknown)
- PATCH /{id} (rename, competition, blank 400)
- DELETE /{id}
- Slots: POST (empty label 400), PATCH, DELETE
- Claims: POST (member not in roster 404, unknown slot 404), DELETE
- Summary tallies: claimed_total sums qty, filled_slots when claimed >= needed.
- Sizes: GET /api/team/sizes still returns 'Sports bra' default.
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://event-planner-394.preview.emergentagent.com"
).rstrip("/")

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


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
    name = f"TEST_Signup_{uuid.uuid4().hex[:6]}"
    r = api_client.post(f"{BASE_URL}/api/roster", json={
        "first_name": name, "last_name": "Athlete", "role": "athlete",
    })
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    yield mid
    api_client.delete(f"{BASE_URL}/api/roster/{mid}")


@pytest.fixture(scope="module")
def test_sheet(api_client):
    """Create a sheet and clean up at module end."""
    name = f"TEST_Sheet_{uuid.uuid4().hex[:6]}"
    r = api_client.post(f"{BASE_URL}/api/team/signups", json={"name": name})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    yield sid
    api_client.delete(f"{BASE_URL}/api/team/signups/{sid}")


# ---------- Sizes regression ----------
class TestSizesSportsBra:
    def test_default_columns_include_sports_bra(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/team/sizes")
        assert r.status_code == 200
        labels = [c["label"] for c in r.json()["columns"]]
        assert "Sports bra" in labels, f"Missing 'Sports bra' in: {labels}"


# ---------- Sheet CRUD ----------
class TestSignupSheetCRUD:
    def test_create_blank_name_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/team/signups", json={"name": "   "})
        assert r.status_code == 400

    def test_create_and_list(self, api_client):
        name = f"TEST_ListSheet_{uuid.uuid4().hex[:6]}"
        r = api_client.post(f"{BASE_URL}/api/team/signups", json={"name": name})
        assert r.status_code == 200
        sid = r.json()["id"]
        assert r.json()["name"] == name
        # list includes it and has summary
        lst = api_client.get(f"{BASE_URL}/api/team/signups")
        assert lst.status_code == 200
        found = [s for s in lst.json() if s["id"] == sid]
        assert len(found) == 1
        summary = found[0].get("summary")
        assert summary is not None
        for k in ("slot_count", "needed_total", "claimed_total", "filled_slots"):
            assert k in summary
        # cleanup
        api_client.delete(f"{BASE_URL}/api/team/signups/{sid}")

    def test_get_unknown_404(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/team/signups/nonexistent-id")
        assert r.status_code == 404

    def test_patch_and_blank_400(self, api_client, test_sheet):
        # blank name -> 400
        rb = api_client.patch(f"{BASE_URL}/api/team/signups/{test_sheet}", json={"name": "  "})
        assert rb.status_code == 400
        # rename ok
        new_name = f"TEST_Renamed_{uuid.uuid4().hex[:5]}"
        r = api_client.patch(f"{BASE_URL}/api/team/signups/{test_sheet}", json={"name": new_name})
        assert r.status_code == 200
        assert r.json()["name"] == new_name
        # verify via GET
        g = api_client.get(f"{BASE_URL}/api/team/signups/{test_sheet}")
        assert g.status_code == 200
        assert g.json()["name"] == new_name

    def test_delete_sheet(self, api_client):
        name = f"TEST_DeleteMe_{uuid.uuid4().hex[:5]}"
        r = api_client.post(f"{BASE_URL}/api/team/signups", json={"name": name})
        sid = r.json()["id"]
        d = api_client.delete(f"{BASE_URL}/api/team/signups/{sid}")
        assert d.status_code == 200
        assert d.json().get("deleted") is True
        g = api_client.get(f"{BASE_URL}/api/team/signups/{sid}")
        assert g.status_code == 404


# ---------- Slots ----------
class TestSignupSlots:
    def test_add_slot_empty_label_400(self, api_client, test_sheet):
        r = api_client.post(f"{BASE_URL}/api/team/signups/{test_sheet}/slots",
                            json={"label": "  ", "qty_needed": 2})
        assert r.status_code == 400

    def test_add_patch_delete_slot(self, api_client, test_sheet):
        # add
        r = api_client.post(f"{BASE_URL}/api/team/signups/{test_sheet}/slots",
                            json={"label": "Snacks", "qty_needed": 3})
        assert r.status_code == 200
        slots = r.json()["slots"]
        slot = [s for s in slots if s["label"] == "Snacks"][0]
        sid = slot["id"]
        assert slot["qty_needed"] == 3
        # patch
        r2 = api_client.patch(f"{BASE_URL}/api/team/signups/{test_sheet}/slots/{sid}",
                              json={"label": "Water", "qty_needed": 5})
        assert r2.status_code == 200
        s2 = [s for s in r2.json()["slots"] if s["id"] == sid][0]
        assert s2["label"] == "Water"
        assert s2["qty_needed"] == 5
        # blank patch -> 400
        rb = api_client.patch(f"{BASE_URL}/api/team/signups/{test_sheet}/slots/{sid}",
                              json={"label": "   "})
        assert rb.status_code == 400
        # delete
        d = api_client.delete(f"{BASE_URL}/api/team/signups/{test_sheet}/slots/{sid}")
        assert d.status_code == 200
        assert not any(s["id"] == sid for s in d.json()["slots"])

    def test_patch_unknown_slot_404(self, api_client, test_sheet):
        r = api_client.patch(f"{BASE_URL}/api/team/signups/{test_sheet}/slots/nope",
                             json={"label": "x"})
        assert r.status_code == 404


# ---------- Claims + summary tally ----------
class TestSignupClaims:
    def _fresh_sheet(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/team/signups",
                            json={"name": f"TEST_Claims_{uuid.uuid4().hex[:5]}"})
        return r.json()["id"]

    def test_claim_unknown_member_404(self, api_client, test_sheet):
        # add slot
        r = api_client.post(f"{BASE_URL}/api/team/signups/{test_sheet}/slots",
                            json={"label": "Volunteers", "qty_needed": 2})
        slot_id = [s for s in r.json()["slots"] if s["label"] == "Volunteers"][0]["id"]
        rc = api_client.post(
            f"{BASE_URL}/api/team/signups/{test_sheet}/slots/{slot_id}/claims",
            json={"member_id": "not-a-real-member", "qty": 1},
        )
        assert rc.status_code == 404
        # cleanup slot
        api_client.delete(f"{BASE_URL}/api/team/signups/{test_sheet}/slots/{slot_id}")

    def test_claim_unknown_slot_404(self, api_client, test_sheet, test_member):
        r = api_client.post(
            f"{BASE_URL}/api/team/signups/{test_sheet}/slots/nonexistent/claims",
            json={"member_id": test_member, "qty": 1},
        )
        assert r.status_code == 404

    def test_add_claim_persists_and_summary(self, api_client, test_member):
        sid = self._fresh_sheet(api_client)
        try:
            # slot needing 3
            r = api_client.post(f"{BASE_URL}/api/team/signups/{sid}/slots",
                                json={"label": "Chaperones", "qty_needed": 3})
            slot_id = r.json()["slots"][0]["id"]
            # claim qty=2
            c1 = api_client.post(
                f"{BASE_URL}/api/team/signups/{sid}/slots/{slot_id}/claims",
                json={"member_id": test_member, "qty": 2, "note": "Bringing water"},
            )
            assert c1.status_code == 200, c1.text
            slot = [s for s in c1.json()["slots"] if s["id"] == slot_id][0]
            claim = slot["claims"][0]
            assert claim["member_id"] == test_member
            assert claim["qty"] == 2
            assert claim["note"] == "Bringing water"

            # summary via list should have claimed_total>=2, filled_slots=0
            lst = api_client.get(f"{BASE_URL}/api/team/signups")
            entry = [x for x in lst.json() if x["id"] == sid][0]
            assert entry["summary"]["claimed_total"] == 2
            assert entry["summary"]["needed_total"] == 3
            assert entry["summary"]["filled_slots"] == 0

            # second claim qty=1 -> filled
            c2 = api_client.post(
                f"{BASE_URL}/api/team/signups/{sid}/slots/{slot_id}/claims",
                json={"member_id": test_member, "qty": 1},
            )
            assert c2.status_code == 200
            g = api_client.get(f"{BASE_URL}/api/team/signups/{sid}")
            assert g.json()["summary"]["claimed_total"] == 3
            assert g.json()["summary"]["filled_slots"] == 1

            # delete second claim
            claims = [s for s in g.json()["slots"] if s["id"] == slot_id][0]["claims"]
            claim2_id = claims[1]["id"]
            d = api_client.delete(
                f"{BASE_URL}/api/team/signups/{sid}/slots/{slot_id}/claims/{claim2_id}"
            )
            assert d.status_code == 200
            slot2 = [s for s in d.json()["slots"] if s["id"] == slot_id][0]
            assert all(c["id"] != claim2_id for c in slot2["claims"])
            # summary reduces
            g2 = api_client.get(f"{BASE_URL}/api/team/signups/{sid}")
            assert g2.json()["summary"]["claimed_total"] == 2
            assert g2.json()["summary"]["filled_slots"] == 0
        finally:
            api_client.delete(f"{BASE_URL}/api/team/signups/{sid}")


class TestAuth:
    def test_unauth_401(self):
        r = requests.get(f"{BASE_URL}/api/team/signups")
        assert r.status_code in (401, 403)
