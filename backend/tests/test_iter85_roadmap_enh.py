"""Iteration 85 — Community Roadmap enhancements:
  1. Comment threads (POST/GET/DELETE /api/roadmap/{id}/comments, DELETE /api/roadmap/comments/{cid})
  2. comment_count on GET /api/roadmap items
  3. Ship notifications (GET /api/roadmap/notifications, POST /api/roadmap/notifications/seen)
  4. Admin gating on POST /api/roadmap/{target}/merge and PATCH /api/roadmap/{id}
  5. New planned items 'Website Companion' (in_progress) and 'In-App Team Chat' (planned)

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


# ---------- New planned items ----------
class TestNewPlannedItems:
    def test_website_companion_in_progress(self, headers):
        r = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        by_title = {p["title"]: p for p in r["planned"]}
        assert "Website Companion" in by_title, "Website Companion missing"
        assert by_title["Website Companion"]["status"] == "in_progress"

    def test_in_app_team_chat_planned(self, headers):
        r = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        by_title = {p["title"]: p for p in r["planned"]}
        assert "In-App Team Chat" in by_title, "In-App Team Chat missing"
        assert by_title["In-App Team Chat"]["status"] == "planned"


# ---------- comment_count field on roadmap items ----------
class TestCommentCountField:
    def test_every_item_has_comment_count(self, headers):
        r = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        for p in r["planned"] + r["suggestions"]:
            assert "comment_count" in p, f"item {p.get('id')} missing comment_count"
            assert isinstance(p["comment_count"], int)
            assert p["comment_count"] >= 0


# ---------- Comment CRUD ----------
class TestComments:
    created_comment_ids = []
    target_item_id = None

    def test_setup_target_suggestion(self, headers):
        # create a fresh suggestion to attach comments to
        r = requests.post(
            f"{BASE_URL}/api/roadmap/suggestions", headers=headers,
            json={"title": "TEST_ Comment target", "description": ""}, timeout=15,
        )
        assert r.status_code == 200
        TestComments.target_item_id = r.json()["id"]

    def test_add_comment(self, headers):
        assert TestComments.target_item_id
        r = requests.post(
            f"{BASE_URL}/api/roadmap/{TestComments.target_item_id}/comments",
            headers=headers, json={"body": "TEST_ first comment"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c.get("body") == "TEST_ first comment"
        assert c.get("is_mine") is True
        assert c.get("author_name")
        assert c.get("id")
        TestComments.created_comment_ids.append(c["id"])

    def test_add_empty_comment_rejected(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/roadmap/{TestComments.target_item_id}/comments",
            headers=headers, json={"body": "   "}, timeout=15,
        )
        assert r.status_code == 400

    def test_add_comment_unknown_item(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/roadmap/nonexistent_zzz/comments",
            headers=headers, json={"body": "hi"}, timeout=15,
        )
        assert r.status_code == 404

    def test_list_comments(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/roadmap/{TestComments.target_item_id}/comments",
            headers=headers, timeout=15,
        )
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        # our own comment should be is_mine=true
        assert any(c.get("is_mine") is True for c in arr)

    def test_comment_count_bumps_on_roadmap(self, headers):
        # After adding a comment, the item's comment_count on /api/roadmap should be >= 1
        r = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        target = next((s for s in r["suggestions"] if s["id"] == TestComments.target_item_id), None)
        assert target is not None
        assert target["comment_count"] >= 1

    def test_delete_own_comment(self, headers):
        assert TestComments.created_comment_ids
        cid = TestComments.created_comment_ids[0]
        r = requests.delete(f"{BASE_URL}/api/roadmap/comments/{cid}", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        # verify removed
        arr = requests.get(
            f"{BASE_URL}/api/roadmap/{TestComments.target_item_id}/comments",
            headers=headers, timeout=15,
        ).json()
        assert all(c["id"] != cid for c in arr)
        TestComments.created_comment_ids.pop(0)

    def test_delete_unknown_comment_404(self, headers):
        r = requests.delete(f"{BASE_URL}/api/roadmap/comments/nonexistent_zzz", headers=headers, timeout=15)
        assert r.status_code == 404


# ---------- Ship notifications ----------
class TestShipNotifications:
    def test_notifications_endpoint_returns_list(self, headers):
        r = requests.get(f"{BASE_URL}/api/roadmap/notifications", headers=headers, timeout=15)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        # A demo notification for 'CSV import wizard' was seeded per the review request.
        # Not strictly required — we just verify the shape when present.
        for n in arr:
            assert n.get("item_title")
            assert n.get("seen") is False

    def test_mark_seen_and_next_get_empty(self, headers):
        r = requests.post(f"{BASE_URL}/api/roadmap/notifications/seen", headers=headers, timeout=15)
        assert r.status_code == 200
        assert "marked" in r.json()
        # after marking seen, GET should return an empty list
        arr = requests.get(f"{BASE_URL}/api/roadmap/notifications", headers=headers, timeout=15).json()
        assert arr == []

    def test_notifications_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/roadmap/notifications", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Admin gates for new endpoints ----------
class TestAdminGates:
    def test_non_admin_cannot_merge(self, headers):
        g = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        sug = g["suggestions"]
        if len(sug) < 2:
            pytest.skip("need at least 2 suggestions to attempt merge")
        target_id = sug[0]["id"]
        source_id = sug[1]["id"]
        r = requests.post(
            f"{BASE_URL}/api/roadmap/{target_id}/merge",
            headers=headers, json={"source_id": source_id}, timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_non_admin_cannot_patch_status(self, headers):
        g = requests.get(f"{BASE_URL}/api/roadmap", headers=headers, timeout=15).json()
        if not g["planned"]:
            pytest.skip("no planned items")
        pid = g["planned"][0]["id"]
        r = requests.patch(
            f"{BASE_URL}/api/roadmap/{pid}", headers=headers,
            json={"status": "completed"}, timeout=15,
        )
        assert r.status_code == 403


# ---------- Cleanup ----------
def test_cleanup_note(headers):
    if TestComments.target_item_id:
        print(f"NOTE: TEST_ suggestion left in DB (admin must delete): {TestComments.target_item_id}")
    if TestComments.created_comment_ids:
        print(f"NOTE: TEST_ comments left: {TestComments.created_comment_ids}")
