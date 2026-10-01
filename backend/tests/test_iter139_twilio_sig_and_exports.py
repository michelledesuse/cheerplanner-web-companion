"""Iteration 139 backend regression tests.

Covers:
- Twilio webhook signature verification (403 when missing/invalid, 200/204 when
  a signature correctly computed with TWILIO_AUTH_TOKEN is sent).
- No regression on login, /api/team/sizes, /api/roster.
"""
import os
import pytest
import requests
from twilio.request_validator import RequestValidator
from urllib.parse import urlparse
from dotenv import dotenv_values

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to the frontend .env (same preview URL the UI uses).
    env = dotenv_values("/app/frontend/.env")
    BASE_URL = (env.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")

BACKEND_ENV = dotenv_values("/app/backend/.env")
AUTH_TOKEN = BACKEND_ENV.get("TWILIO_AUTH_TOKEN") or os.environ.get("TWILIO_AUTH_TOKEN") or ""

DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASSWORD = "CheerDemo2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_token(session):
    r = session.post(f"{BASE_URL}/api/auth/login", json={
        "email": DEMO_EMAIL, "password": DEMO_PASSWORD,
    }, timeout=15)
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.text[:200]}"
    return tok


# ---------- Twilio signature verification ----------

def _sign(url: str, params: dict) -> str:
    v = RequestValidator(AUTH_TOKEN)
    return v.compute_signature(url, params)


class TestTwilioInbound:
    URL = "/api/twilio/inbound"

    def test_inbound_missing_signature_is_403(self):
        r = requests.post(f"{BASE_URL}{self.URL}",
                          data={"From": "+15555550123", "Body": "hi", "MessageSid": "SM_test_iter139_a"},
                          timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_inbound_invalid_signature_is_403(self):
        r = requests.post(
            f"{BASE_URL}{self.URL}",
            data={"From": "+15555550123", "Body": "hi", "MessageSid": "SM_test_iter139_b"},
            headers={"X-Twilio-Signature": "not-a-valid-signature"},
            timeout=10,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_inbound_valid_signature_accepted(self):
        params = {"From": "+15555550123", "Body": "TEST_iter139", "MessageSid": "SM_test_iter139_c"}
        full_url = f"{BASE_URL}{self.URL}"
        sig = _sign(full_url, params)
        r = requests.post(
            full_url, data=params,
            headers={"X-Twilio-Signature": sig},
            timeout=10,
        )
        assert r.status_code in (200, 204), f"expected 200/204 w/ valid sig, got {r.status_code}: {r.text[:200]}"


class TestTwilioStatus:
    URL = "/api/twilio/status"

    def test_status_missing_signature_is_403(self):
        r = requests.post(f"{BASE_URL}{self.URL}",
                          data={"MessageSid": "SM_test_iter139_s_a", "MessageStatus": "delivered"},
                          timeout=10)
        assert r.status_code == 403

    def test_status_invalid_signature_is_403(self):
        r = requests.post(
            f"{BASE_URL}{self.URL}",
            data={"MessageSid": "SM_test_iter139_s_b", "MessageStatus": "delivered"},
            headers={"X-Twilio-Signature": "bogus"},
            timeout=10,
        )
        assert r.status_code == 403

    def test_status_valid_signature_accepted(self):
        params = {"MessageSid": "SM_test_iter139_s_c", "MessageStatus": "delivered"}
        full_url = f"{BASE_URL}{self.URL}"
        sig = _sign(full_url, params)
        r = requests.post(
            full_url, data=params,
            headers={"X-Twilio-Signature": sig},
            timeout=10,
        )
        # For an unknown SID the handler short-circuits with 204.
        assert r.status_code in (200, 204), f"expected 200/204 w/ valid sig, got {r.status_code}: {r.text[:200]}"


# ---------- Regression: core endpoints must still work ----------

class TestNoRegression:
    def test_login_ok(self, auth_token):
        assert auth_token

    def test_team_sizes_shape(self, session, auth_token):
        r = session.get(f"{BASE_URL}/api/team/sizes",
                        headers={"Authorization": f"Bearer {auth_token}"}, timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "columns" in body and "values" in body, f"missing keys: {list(body.keys())}"
        assert isinstance(body["columns"], list)
        assert isinstance(body["values"], dict)
        # columns should have id/label fields
        if body["columns"]:
            c = body["columns"][0]
            assert "id" in c and "label" in c

    def test_roster_list(self, session, auth_token):
        r = session.get(f"{BASE_URL}/api/roster",
                        headers={"Authorization": f"Bearer {auth_token}"}, timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert "id" in data[0] and "name" in data[0]
