"""Iteration 84 — Community Roadmap: planned + suggestions + upvotes.

Non-admin flows via applereview@cheerplanner.app / Review2026!.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    d = r.json()
    return d.get("access_token") or d.get("token")


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- GET /api/roadmap ----------
class TestRoadmapList:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/roadmap", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_returns_expected_shape(self, headers):
        r = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(["planned", "suggestions", "is_admin"]).issubset(data.keys())
        assert isinstance(data["planned"], list)
        assert isinstance(data["suggestions"], list)
        assert data["is_admin"] is False, "applereview must not be admin"

    def test_seeded_planned_items_present(self, headers):
        r = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15)
        titles = {p["title"] for p in r.json()["planned"]}
        expected = {"Weather on event dates", "Smart autofill for forms", "CSV import wizard"}
        missing = expected - titles
        assert not missing, f"missing seeded planned items: {missing}"

        # Verify statuses on seeded items
        planned_by_title = {p["title"]: p for p in r.json()["planned"]}
        assert planned_by_title["Weather on event dates"]["status"] == "in_progress"
        assert planned_by_title["Smart autofill for forms"]["status"] == "planned"
        assert planned_by_title["CSV import wizard"]["status"] == "completed"

    def test_planned_items_have_required_fields(self, headers):
        r = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15)
        for p in r.json()["planned"]:
            assert "id" in p and "title" in p and "upvotes" in p and "voted" in p
            assert isinstance(p["upvotes"], int)
            assert isinstance(p["voted"], bool)


# ---------- POST /api/roadmap/suggestions ----------
class TestCreateSuggestion:
    created_ids = []

    def test_create_suggestion_auto_upvoted(self, headers):
        payload = {"title": "TEST_ Add moon-phase widget", "description": "TEST_ description"}
        r = requests.post(f"{BASE_URL}/api/roadmap/suggestions", headers=headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["title"] == payload["title"]
        assert doc["type"] == "suggestion"
        assert doc["upvotes"] == 1
        assert doc["voted"] is True
        assert doc.get("id")
        TestCreateSuggestion.created_ids.append(doc["id"])

        # verify persistence via GET
        g = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15)
        assert g.status_code == 200
        found = next((s for s in g.json()["suggestions"] if s["id"] == doc["id"]), None)
        assert found is not None, "suggestion did not persist"
        assert found["upvotes"] == 1
        assert found["voted"] is True

    def test_reject_empty_title(self, headers):
        r = requests.post(f"{BASE_URL}/api/roadmap/suggestions", headers=headers, json={"title": "   "}, timeout=15)
        assert r.status_code == 400


# ---------- POST /api/roadmap/{id}/vote ----------
class TestVoteToggle:
    @pytest.fixture(scope="class")
    def suggestion_id(self, headers):
        # create a fresh suggestion for isolated toggle testing
        r = requests.post(
            f"{BASE_URL}/api/roadmap/suggestions", headers=headers,
            json={"title": "TEST_ Vote toggle target", "description": ""}, timeout=15,
        )
        assert r.status_code == 200
        return r.json()["id"]

    def test_toggle_removes_own_vote(self, headers, suggestion_id):
        # author already auto-voted, so first toggle should DECREMENT to 0
        r = requests.post(f"{BASE_URL}/api/roadmap/{suggestion_id}/vote", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["voted"] is False
        assert data["upvotes"] == 0

    def test_toggle_adds_vote_back(self, headers, suggestion_id):
        r = requests.post(f"{BASE_URL}/api/roadmap/{suggestion_id}/vote", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["voted"] is True
        assert data["upvotes"] == 1

    def test_count_never_negative(self, headers, suggestion_id):
        # Force to unvoted state
        cur = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        target = next((s for s in cur["suggestions"] if s["id"] == suggestion_id), None)
        assert target is not None
        if target["voted"]:
            requests.post(f"{BASE_URL}/api/roadmap/{suggestion_id}/vote", headers=headers, timeout=15)
        # Now item is unvoted with count=0; toggling again shouldn't go below 0
        # (2 rapid toggles will yield same state)
        r1 = requests.post(f"{BASE_URL}/api/roadmap/{suggestion_id}/vote", headers=headers, timeout=15)
        assert r1.json()["upvotes"] >= 0

    def test_vote_persists_on_get(self, headers, suggestion_id):
        # ensure current voted state matches GET
        v = requests.post(f"{BASE_URL}/api/roadmap/{suggestion_id}/vote", headers=headers, timeout=15).json()
        g = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        target = next((s for s in g["suggestions"] if s["id"] == suggestion_id), None)
        assert target is not None
        assert target["voted"] == v["voted"]
        assert target["upvotes"] == v["upvotes"]

    def test_vote_on_planned_item(self, headers):
        g = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        planned = g["planned"]
        assert planned, "no planned items available"
        pid = planned[0]["id"]
        before = planned[0]["upvotes"]
        was_voted = planned[0]["voted"]
        r = requests.post(f"{BASE_URL}/api/roadmap/{pid}/vote", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["voted"] == (not was_voted)
        expected = before + (1 if not was_voted else -1)
        assert data["upvotes"] == max(0, expected)
        # revert to keep seed data clean
        requests.post(f"{BASE_URL}/api/roadmap/{pid}/vote", headers=headers, timeout=15)

    def test_vote_404_on_unknown_id(self, headers):
        r = requests.post(f"{BASE_URL}/api/roadmap/nonexistent_zzz/vote", headers=headers, timeout=15)
        assert r.status_code == 404


# ---------- Admin gates ----------
class TestAdminGates:
    def test_non_admin_cannot_create_planned(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/roadmap/planned", headers=headers,
            json={"title": "TEST_ should be blocked", "description": "", "status": "planned"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_non_admin_cannot_patch(self, headers):
        # need an existing item id
        g = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        if not g["planned"]:
            pytest.skip("no planned items to patch")
        pid = g["planned"][0]["id"]
        r = requests.patch(f"{BASE_URL}/api/roadmap/{pid}", headers=headers, json={"title": "TEST_ hack"}, timeout=15)
        assert r.status_code == 403

    def test_non_admin_cannot_delete(self, headers):
        g = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        if not g["planned"]:
            pytest.skip("no planned items to delete")
        pid = g["planned"][0]["id"]
        r = requests.delete(f"{BASE_URL}/api/roadmap/{pid}", headers=headers, timeout=15)
        assert r.status_code == 403


# ---------- Cleanup ----------
def test_cleanup_created_suggestions(headers):
    """Best-effort cleanup: only admins can DELETE, so we can't actually remove
    the TEST_ suggestions here. Just document the leftover ids for the operator."""
    if TestCreateSuggestion.created_ids:
        print(f"NOTE: TEST_ suggestions left in DB (admin must delete): {TestCreateSuggestion.created_ids}")
