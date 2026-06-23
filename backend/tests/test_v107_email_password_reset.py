"""v1.0.7 backend tests:
- POST /api/auth/forgot-password (rate-limited, no enumeration)
- POST /api/auth/reset-password (JWT verification + password update)
- GET/PATCH /api/notifications/preferences
- GET /api/notifications/unsubscribe (HTML, JWT)
"""
import os
import sys
import time
import pytest
import requests

# Ensure backend importable so we can mint JWT reset tokens inline.
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
TEST_EMAIL = "applereview@cheerplanner.app"
ORIG_PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": TEST_EMAIL, "password": ORIG_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    return {"Authorization": f"Bearer {data['access_token']}", "Content-Type": "application/json"}, data["user"]["id"]


# ============================================================
# A. POST /api/auth/forgot-password
# ============================================================
class TestForgotPassword:
    def test_valid_email_returns_ok(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": TEST_EMAIL})
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

    def test_unknown_email_returns_ok_no_enumeration(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": "nobody-xyz@nowhere.com"})
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

    def test_malformed_email_returns_422(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": "not-an-email"})
        assert r.status_code == 422

    def test_rate_limit_burst_triggers_429(self):
        # Endpoint is decorated 5/minute. Burst 12 to be robust against
        # in-memory bucket resets caused by upstream reloads.
        statuses = []
        for _ in range(12):
            r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": "ratelimit-burst@nowhere.com"})
            statuses.append(r.status_code)
        assert 429 in statuses, f"expected a 429 within 12 rapid calls, got {statuses}"


# ============================================================
# B. POST /api/auth/reset-password
# ============================================================
class TestResetPassword:
    def test_valid_token_resets_password_then_restored(self, auth_headers):
        _, user_id = auth_headers
        from core.email import make_password_reset_token
        token = make_password_reset_token(user_id)

        new_pw = "TempReset123!"
        r = requests.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": token, "new_password": new_pw},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Login with new password works
        r2 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": TEST_EMAIL, "password": new_pw})
        assert r2.status_code == 200, r2.text

        # Restore original password
        token2 = make_password_reset_token(user_id)
        r3 = requests.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": token2, "new_password": ORIG_PASSWORD},
        )
        assert r3.status_code == 200, r3.text

        # Login with original works again
        r4 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": TEST_EMAIL, "password": ORIG_PASSWORD})
        assert r4.status_code == 200, r4.text

    def test_invalid_token_returns_400(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": "garbage.token.value", "new_password": "Strong123!"},
        )
        assert r.status_code == 400
        assert "invalid" in r.json().get("detail", "").lower()

    def test_short_password_returns_422(self, auth_headers):
        _, user_id = auth_headers
        from core.email import make_password_reset_token
        token = make_password_reset_token(user_id)
        r = requests.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": token, "new_password": "abc"},
        )
        assert r.status_code == 422


# ============================================================
# C/D. Notification preferences
# ============================================================
class TestNotificationPreferences:
    def test_get_returns_shape_with_defaults(self, auth_headers):
        headers, _ = auth_headers
        r = requests.get(f"{BASE_URL}/api/notifications/preferences", headers=headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.keys()) >= {"enabled", "frequency", "categories", "timezone"}
        cats = data["categories"]
        for k in ["expense_due", "booking_balance", "booking_cancel_by",
                  "booking_release", "competition_event", "packing"]:
            assert k in cats

    def test_patch_frequency_weekly(self, auth_headers):
        headers, _ = auth_headers
        r = requests.patch(f"{BASE_URL}/api/notifications/preferences",
                           headers=headers, json={"frequency": "weekly"})
        assert r.status_code == 200, r.text
        assert r.json()["frequency"] == "weekly"

    def test_patch_frequency_off_flips_enabled(self, auth_headers):
        headers, _ = auth_headers
        r = requests.patch(f"{BASE_URL}/api/notifications/preferences",
                           headers=headers, json={"frequency": "off"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["frequency"] == "off"
        assert body["enabled"] is False

    def test_patch_category_toggle_preserves_others(self, auth_headers):
        headers, _ = auth_headers
        # First enable so we can read full category set
        requests.patch(f"{BASE_URL}/api/notifications/preferences",
                       headers=headers, json={"enabled": True, "frequency": "daily"})
        before = requests.get(f"{BASE_URL}/api/notifications/preferences", headers=headers).json()
        r = requests.patch(f"{BASE_URL}/api/notifications/preferences",
                           headers=headers, json={"categories": {"packing": False}})
        assert r.status_code == 200, r.text
        after = r.json()
        assert after["categories"]["packing"] is False
        # other categories unchanged
        for k in ["expense_due", "booking_balance", "booking_cancel_by",
                  "booking_release", "competition_event"]:
            assert after["categories"][k] == before["categories"][k], f"{k} changed unexpectedly"

    def test_patch_reenable(self, auth_headers):
        headers, _ = auth_headers
        r = requests.patch(f"{BASE_URL}/api/notifications/preferences",
                           headers=headers, json={"enabled": True, "frequency": "daily",
                                                   "categories": {"packing": True}})
        assert r.status_code == 200
        body = r.json()
        assert body["enabled"] is True
        assert body["frequency"] == "daily"

    def test_unauthed_get_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/notifications/preferences")
        assert r.status_code in (401, 403)


# ============================================================
# E. Unsubscribe HTML page (no auth)
# ============================================================
class TestUnsubscribe:
    def test_valid_token_unsubscribes(self, auth_headers):
        headers, user_id = auth_headers
        from core.email import make_unsubscribe_token
        token = make_unsubscribe_token(user_id)
        r = requests.get(f"{BASE_URL}/api/notifications/unsubscribe", params={"token": token})
        assert r.status_code == 200, r.text
        assert "unsubscribed" in r.text.lower()
        # verify prefs flipped
        prefs = requests.get(f"{BASE_URL}/api/notifications/preferences", headers=headers).json()
        assert prefs["enabled"] is False
        assert prefs["frequency"] == "off"
        # restore
        requests.patch(f"{BASE_URL}/api/notifications/preferences",
                       headers=headers, json={"enabled": True, "frequency": "daily"})

    def test_invalid_token_returns_400_html(self):
        r = requests.get(f"{BASE_URL}/api/notifications/unsubscribe", params={"token": "garbage"})
        assert r.status_code == 400
        assert "expired" in r.text.lower() or "invalid" in r.text.lower()


# ============================================================
# F. Regression — core endpoints still respond
# ============================================================
class TestRegression:
    @pytest.mark.parametrize("path", [
        "/api/athletes",
        "/api/expenses",
        "/api/payments",
        "/api/competitions",
        "/api/bookings",
        "/api/calendar",
        "/api/fundraisers",
        "/api/reminders",
        "/api/dashboard",
        "/api/schedule",
        "/api/packing-templates",
    ])
    def test_endpoint_200(self, auth_headers, path):
        headers, _ = auth_headers
        r = requests.get(f"{BASE_URL}{path}", headers=headers)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
