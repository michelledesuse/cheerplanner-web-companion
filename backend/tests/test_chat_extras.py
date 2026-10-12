"""Tests for new chat_extras router: pinned items + quick-add.

Covers all endpoints under /api/team/chat/pin-items, pin-options, and
/api/team/chat/messages/{id}/quick-add. Uses the live preview backend.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

STAFF = ("applereview@cheerplanner.app", "Review2026!")
PARENT = ("parent.taylor@cheerplanner.app", "CheerDemo2026!")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def staff_h():
    t = _login(*STAFF)
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def parent_h():
    t = _login(*PARENT)
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------- pin-items ----------

class TestPinItems:
    def test_list_as_staff(self, staff_h):
        r = requests.get(f"{API}/team/chat/pin-items", headers=staff_h, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "can_pin" in data
        assert data["can_pin"] is True
        titles = [i["title"] for i in data["items"]]
        print("Seeded staff pins:", titles)
        # Seed should include Summit + Uniform pickup
        assert any("Summit" in t for t in titles), f"Missing Summit pin: {titles}"
        assert any("Uniform" in t for t in titles), f"Missing Uniform pickup pin: {titles}"

    def test_list_as_parent_no_pin_perms(self, parent_h):
        r = requests.get(f"{API}/team/chat/pin-items", headers=parent_h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["can_pin"] is False
        assert len(d["items"]) >= 2  # Parent can see pins

    def test_pin_options_staff_event(self, staff_h):
        r = requests.get(f"{API}/team/chat/pin-options", params={"kind": "event"}, headers=staff_h, timeout=30)
        assert r.status_code == 200, r.text
        assert "options" in r.json()

    def test_pin_options_bad_kind(self, staff_h):
        r = requests.get(f"{API}/team/chat/pin-options", params={"kind": "bogus"}, headers=staff_h, timeout=30)
        assert r.status_code == 400

    def test_pin_options_parent_forbidden(self, parent_h):
        r = requests.get(f"{API}/team/chat/pin-options", params={"kind": "event"}, headers=parent_h, timeout=30)
        assert r.status_code == 403

    def test_create_custom_requires_title(self, staff_h):
        r = requests.post(f"{API}/team/chat/pin-items", json={"kind": "custom", "body": "no title"}, headers=staff_h, timeout=30)
        assert r.status_code == 400

    def test_create_bad_kind(self, staff_h):
        r = requests.post(f"{API}/team/chat/pin-items", json={"kind": "nope"}, headers=staff_h, timeout=30)
        assert r.status_code == 400

    def test_create_delete_custom_pin(self, staff_h):
        r = requests.post(
            f"{API}/team/chat/pin-items",
            json={"kind": "custom", "title": "TEST_pin_custom", "body": "detail body"},
            headers=staff_h, timeout=30
        )
        assert r.status_code == 200, r.text
        pin_id = r.json()["id"]

        # Verify in listing
        lst = requests.get(f"{API}/team/chat/pin-items", headers=staff_h, timeout=30).json()
        assert any(p["id"] == pin_id for p in lst["items"])

        # Delete
        d = requests.delete(f"{API}/team/chat/pin-items/{pin_id}", headers=staff_h, timeout=30)
        assert d.status_code == 200
        # 404 on repeat delete
        d2 = requests.delete(f"{API}/team/chat/pin-items/{pin_id}", headers=staff_h, timeout=30)
        assert d2.status_code == 404

    def test_parent_cannot_create_pin(self, parent_h):
        r = requests.post(
            f"{API}/team/chat/pin-items",
            json={"kind": "custom", "title": "TEST_parent", "body": "x"},
            headers=parent_h, timeout=30
        )
        assert r.status_code == 403

    def test_pin_competition_and_duplicate(self, staff_h):
        opts = requests.get(f"{API}/team/chat/pin-options", params={"kind": "competition"}, headers=staff_h, timeout=30).json()["options"]
        # Pick an unpinned comp
        existing = requests.get(f"{API}/team/chat/pin-items", headers=staff_h, timeout=30).json()["items"]
        pinned_refs = {p.get("ref_id") for p in existing if p["kind"] == "competition"}
        target = next((o for o in opts if o["id"] not in pinned_refs), None)
        if not target:
            pytest.skip("No unpinned competition available")
        r = requests.post(f"{API}/team/chat/pin-items",
                          json={"kind": "competition", "ref_id": target["id"]},
                          headers=staff_h, timeout=30)
        assert r.status_code == 200, r.text
        pin_id = r.json()["id"]
        # 409 on duplicate
        dup = requests.post(f"{API}/team/chat/pin-items",
                            json={"kind": "competition", "ref_id": target["id"]},
                            headers=staff_h, timeout=30)
        assert dup.status_code == 409
        # Cleanup
        requests.delete(f"{API}/team/chat/pin-items/{pin_id}", headers=staff_h, timeout=30)

    def test_parent_cannot_delete(self, parent_h, staff_h):
        # Staff creates pin
        r = requests.post(f"{API}/team/chat/pin-items",
                          json={"kind": "custom", "title": "TEST_del_perm", "body": "x"},
                          headers=staff_h, timeout=30)
        pin_id = r.json()["id"]
        d = requests.delete(f"{API}/team/chat/pin-items/{pin_id}", headers=parent_h, timeout=30)
        assert d.status_code == 403
        requests.delete(f"{API}/team/chat/pin-items/{pin_id}", headers=staff_h, timeout=30)


# ---------- quick-add ----------

class TestQuickAdd:
    def test_quickadd_nonexistent_message(self, staff_h):
        r = requests.post(f"{API}/team/chat/messages/does-not-exist-abc/quick-add", headers=staff_h, timeout=30)
        assert r.status_code == 404

    def test_quickadd_full_message(self, staff_h):
        msg_text = ("Spirit Nationals packing: bring 2 bows, white shoes, and $40 for "
                    "spectator tickets due Nov 1. Watch Cheer Athletics Panthers at 11:40")
        # Post a message
        p = requests.post(f"{API}/team/chat/messages", json={"text": msg_text}, headers=staff_h, timeout=30)
        assert p.status_code == 200, p.text
        mid = p.json()["id"]
        try:
            qa = requests.post(f"{API}/team/chat/messages/{mid}/quick-add", headers=staff_h, timeout=60)
            assert qa.status_code == 200, qa.text
            sugg = qa.json().get("suggestions", {})
            print("quick-add suggestions:", list(sugg.keys()))
            # Should contain at least packing and expense (and ideally watch)
            assert "packing" in sugg or "expense" in sugg or "watch" in sugg, f"Expected AI suggestions, got {sugg}"
        finally:
            requests.delete(f"{API}/team/chat/messages/{mid}", headers=staff_h, timeout=30)

    def test_quickadd_parent_can_use(self, parent_h, staff_h):
        # Staff posts a message, parent should also be able to request suggestions
        p = requests.post(f"{API}/team/chat/messages",
                          json={"text": "Reminder: full-out run-throughs at Saturday practice — bring water!"},
                          headers=staff_h, timeout=30)
        mid = p.json()["id"]
        try:
            qa = requests.post(f"{API}/team/chat/messages/{mid}/quick-add", headers=parent_h, timeout=60)
            assert qa.status_code == 200, qa.text
            sugg = qa.json().get("suggestions", {})
            print("parent quick-add:", list(sugg.keys()))
        finally:
            requests.delete(f"{API}/team/chat/messages/{mid}", headers=staff_h, timeout=30)
