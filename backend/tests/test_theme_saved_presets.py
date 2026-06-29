"""Tests for v1.0.8 named-preset save/delete endpoints.

Endpoints covered:
- POST /api/household/theme/saved
- DELETE /api/household/theme/saved/{id}
- GET /api/household (persistence verification)
- PATCH /api/household/theme (apply preset_id, cleanup)
"""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in login response: {data}"
    return token


@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestSavedPresetLifecycle:
    """Full lifecycle: save -> persist -> apply built-in -> reapply saved -> delete -> cleanup."""

    saved_ids: list = []

    def test_01_initial_household_has_theme(self, headers):
        r = requests.get(f"{BASE_URL}/api/household", headers=headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "theme" in body
        assert isinstance(body["theme"], dict)

    def test_02_save_named_preset(self, headers):
        payload = {
            "name": "TEST_GymDay",
            "accent": "#FF6600",
            "accentSubtle": "#FF660022",
            "bg": "#101010",
            "card": "#1B1B1B",
            "textPrimary": "#F5F5F5",
            "tabActive": "#FF6600",
        }
        r = requests.post(
            f"{BASE_URL}/api/household/theme/saved",
            headers=headers,
            json=payload,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "preset" in body and "theme" in body
        entry = body["preset"]
        assert entry["name"] == "TEST_GymDay"
        assert entry["accent"] == "#FF6600"
        assert entry["bg"] == "#101010"
        assert entry["id"].startswith("saved_"), entry["id"]
        # Active preset becomes the saved one
        assert body["theme"]["preset_id"] == entry["id"]
        saved_list = body["theme"].get("saved") or []
        assert any(s["id"] == entry["id"] for s in saved_list)
        TestSavedPresetLifecycle.saved_ids.append(entry["id"])

    def test_03_persistence_via_get_household(self, headers):
        assert TestSavedPresetLifecycle.saved_ids, "no saved id from previous test"
        sid = TestSavedPresetLifecycle.saved_ids[0]
        r = requests.get(f"{BASE_URL}/api/household", headers=headers, timeout=20)
        assert r.status_code == 200
        theme = r.json().get("theme") or {}
        assert theme.get("preset_id") == sid
        saved_ids = [s.get("id") for s in (theme.get("saved") or [])]
        assert sid in saved_ids

    def test_04_save_requires_accent_and_bg(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/household/theme/saved",
            headers=headers,
            json={"name": "TEST_bad", "card": "#fff"},
            timeout=20,
        )
        assert r.status_code == 400
        assert "accent" in r.text.lower()

    def test_05_apply_builtin_preset(self, headers):
        r = requests.patch(
            f"{BASE_URL}/api/household/theme",
            headers=headers,
            json={"preset_id": "green_black"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        # verify
        g = requests.get(f"{BASE_URL}/api/household", headers=headers, timeout=20)
        assert g.json()["theme"]["preset_id"] == "green_black"

    def test_06_apply_saved_preset_by_id(self, headers):
        sid = TestSavedPresetLifecycle.saved_ids[0]
        r = requests.patch(
            f"{BASE_URL}/api/household/theme",
            headers=headers,
            json={"preset_id": sid},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/household", headers=headers, timeout=20)
        assert g.json()["theme"]["preset_id"] == sid

    def test_07_save_second_preset(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/household/theme/saved",
            headers=headers,
            json={
                "name": "TEST_Second",
                "accent": "#00AAFF",
                "bg": "#FAFAFF",
                "card": "#FFFFFF",
                "textPrimary": "#000033",
                "tabActive": "#00AAFF",
            },
            timeout=20,
        )
        assert r.status_code == 200
        entry = r.json()["preset"]
        TestSavedPresetLifecycle.saved_ids.append(entry["id"])
        # both should now exist in saved list
        g = requests.get(f"{BASE_URL}/api/household", headers=headers, timeout=20)
        ids = [s["id"] for s in g.json()["theme"].get("saved", [])]
        for sid in TestSavedPresetLifecycle.saved_ids:
            assert sid in ids

    def test_08_delete_first_saved(self, headers):
        sid = TestSavedPresetLifecycle.saved_ids[0]
        r = requests.delete(
            f"{BASE_URL}/api/household/theme/saved/{sid}",
            headers=headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        saved = r.json()["theme"].get("saved") or []
        assert all(s["id"] != sid for s in saved)
        # GET confirms
        g = requests.get(f"{BASE_URL}/api/household", headers=headers, timeout=20)
        ids = [s["id"] for s in g.json()["theme"].get("saved", [])]
        assert sid not in ids

    def test_09_delete_second_saved(self, headers):
        sid = TestSavedPresetLifecycle.saved_ids[1]
        r = requests.delete(
            f"{BASE_URL}/api/household/theme/saved/{sid}",
            headers=headers,
            timeout=20,
        )
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/household", headers=headers, timeout=20)
        ids = [s["id"] for s in g.json()["theme"].get("saved", [])]
        assert sid not in ids

    def test_10_cleanup_reset_to_red_white(self, headers):
        r = requests.patch(
            f"{BASE_URL}/api/household/theme",
            headers=headers,
            json={"preset_id": "red_white"},
            timeout=20,
        )
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/household", headers=headers, timeout=20)
        assert g.json()["theme"]["preset_id"] == "red_white"
