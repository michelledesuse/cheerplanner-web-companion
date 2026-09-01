"""Backend tests for the Flyer Generator (iter113) — coach/staff-only endpoints.

Covers:
- POST /api/team/coach-ai/flyer  (Imagen 4 -> gemini-2.5-flash-image fallback)
- GET  /api/team/coach-ai/logos
- GET  /api/team/coach-ai/flyers
- GET  /api/team/coach-ai/flyers/{id}
- DELETE /api/team/coach-ai/flyers/{id}
- POST /api/team/coach-ai/flyer/{id}/post-to-chat
- Non-staff (parent/athlete) receives 403
- Chat deletion permission of the posted flyer message
"""
import os
import time
import base64

import pytest
import requests


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

STAFF_EMAIL = "demo@cheerplanner.app"
STAFF_PW = "CheerDemo2026!"
COACH_EMAIL = "coach.casey@cheerplanner.app"
COACH_PW = "CheerDemo2026!"
NON_STAFF_EMAIL = "sophia.athlete@cheerplanner.app"
NON_STAFF_PW = "CheerDemo2026!"


# ---------- helpers ----------
def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def staff_token():
    return _login(STAFF_EMAIL, STAFF_PW)


@pytest.fixture(scope="module")
def coach_token():
    return _login(COACH_EMAIL, COACH_PW)


@pytest.fixture(scope="module")
def non_staff_token():
    return _login(NON_STAFF_EMAIL, NON_STAFF_PW)


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- auth gating ----------
class TestAuthGating:
    def test_flyer_generate_requires_staff(self, non_staff_token):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/flyer",
            headers=_h(non_staff_token),
            json={"title": "TEST_denied", "event_type": "event"},
            timeout=30,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_list_logos_requires_staff(self, non_staff_token):
        r = requests.get(f"{BASE_URL}/api/team/coach-ai/logos", headers=_h(non_staff_token), timeout=30)
        assert r.status_code == 403

    def test_list_flyers_requires_staff(self, non_staff_token):
        r = requests.get(f"{BASE_URL}/api/team/coach-ai/flyers", headers=_h(non_staff_token), timeout=30)
        assert r.status_code == 403


# ---------- listing ----------
class TestListing:
    def test_list_flyers_ok(self, staff_token):
        r = requests.get(f"{BASE_URL}/api/team/coach-ai/flyers", headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "flyers" in data and isinstance(data["flyers"], list)

    def test_list_logos_ok(self, staff_token):
        r = requests.get(f"{BASE_URL}/api/team/coach-ai/logos", headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "logos" in data and isinstance(data["logos"], list)


# ---------- generation validation ----------
class TestGenerateValidation:
    def test_missing_title_400(self, staff_token):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/flyer",
            headers=_h(staff_token),
            json={"event_type": "event"},
            timeout=30,
        )
        assert r.status_code == 400


# Track created flyer for downstream tests / cleanup
_created = {"flyer_id": None}


class TestGenerateAndPost:
    def test_generate_flyer_returns_image(self, staff_token):
        """Live generation call. Can take ~30-60s (Imagen 4 -> fallback)."""
        payload = {
            "title": "TEST_iter113 Flyer",
            "team_name": "TEST_Elite Allstars",
            "event_type": "event",
            "style": "classic",
            "date": "Saturday, Aug 15",
            "time": "10:00 AM",
            "location": "Champion Gym",
            "theme": "Navy & gold",
            "details": "TEST auto flyer",
            "auto_layout": True,
        }
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/team/coach-ai/flyer",
                          headers=_h(staff_token), json=payload, timeout=180)
        elapsed = time.time() - t0
        print(f"Flyer generation took {elapsed:.1f}s -> status={r.status_code}")
        assert r.status_code == 200, f"generation failed: {r.status_code} {r.text[:500]}"
        data = r.json()
        assert data.get("flyer_id"), "missing flyer_id"
        assert data.get("image_base64"), "missing image_base64"
        # Decode a few bytes to sanity-check it's real PNG/JPEG
        raw = base64.b64decode(data["image_base64"])
        assert len(raw) > 10_000, f"image too small: {len(raw)} bytes"
        _created["flyer_id"] = data["flyer_id"]

    def test_get_flyer_by_id(self, staff_token):
        fid = _created.get("flyer_id")
        if not fid:
            pytest.skip("generation didn't produce a flyer_id")
        r = requests.get(f"{BASE_URL}/api/team/coach-ai/flyers/{fid}",
                         headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j.get("flyer_id") == fid
        assert j.get("image_base64")

    def test_flyer_appears_in_list(self, staff_token):
        fid = _created.get("flyer_id")
        if not fid:
            pytest.skip("no flyer id")
        r = requests.get(f"{BASE_URL}/api/team/coach-ai/flyers", headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        ids = [f["id"] for f in r.json().get("flyers", [])]
        assert fid in ids

    def test_post_to_chat(self, staff_token):
        fid = _created.get("flyer_id")
        if not fid:
            pytest.skip("no flyer id")
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/flyer/{fid}/post-to-chat",
            headers=_h(staff_token),
            json={"caption": "TEST_iter113 caption"},
            timeout=30,
        )
        assert r.status_code == 200, f"post-to-chat failed: {r.status_code} {r.text}"
        j = r.json()
        assert j.get("ok") is True
        assert j.get("message_id")
        _created["message_id"] = j["message_id"]

    def test_non_staff_cannot_delete_chat_message(self, non_staff_token, staff_token):
        """Parent/athlete without team_access should get 403 attempting to delete the coach's flyer message."""
        mid = _created.get("message_id")
        if not mid:
            pytest.skip("no message id")
        r = requests.delete(
            f"{BASE_URL}/api/team/chat/messages/{mid}",
            headers=_h(non_staff_token),
            timeout=30,
        )
        # Non-staff either cannot access team chat at all (403) or is not allowed (403/404).
        assert r.status_code in (403, 404), f"expected 403/404, got {r.status_code}: {r.text}"

    def test_staff_can_delete_chat_message(self, staff_token):
        mid = _created.get("message_id")
        if not mid:
            pytest.skip("no message id")
        r = requests.delete(
            f"{BASE_URL}/api/team/chat/messages/{mid}",
            headers=_h(staff_token),
            timeout=30,
        )
        assert r.status_code in (200, 204), f"staff delete failed: {r.status_code} {r.text}"


class TestDelete:
    def test_non_staff_cannot_delete_flyer(self, non_staff_token):
        fid = _created.get("flyer_id")
        if not fid:
            pytest.skip("no flyer id")
        r = requests.delete(f"{BASE_URL}/api/team/coach-ai/flyers/{fid}",
                            headers=_h(non_staff_token), timeout=30)
        assert r.status_code == 403

    def test_delete_flyer_and_verify_gone(self, staff_token):
        fid = _created.get("flyer_id")
        if not fid:
            pytest.skip("no flyer id")
        r = requests.delete(f"{BASE_URL}/api/team/coach-ai/flyers/{fid}",
                            headers=_h(staff_token), timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        # Verify gone
        r2 = requests.get(f"{BASE_URL}/api/team/coach-ai/flyers/{fid}",
                          headers=_h(staff_token), timeout=30)
        assert r2.status_code == 404
