"""Backend tests for the Twilio SMS opt-in flow (v2.2).

Covers GET & PATCH /api/notifications/preferences with the new
sms_enabled / sms_phone / sms_consent_at fields.
"""
import os
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://event-planner-394.preview.emergentagent.com"

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- GET preferences returns SMS fields ---
def test_get_prefs_returns_sms_fields(headers):
    r = requests.get(f"{BASE_URL}/api/notifications/preferences", headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "sms_enabled" in data
    assert "sms_phone" in data
    assert "sms_consent_at" in data
    assert isinstance(data["sms_enabled"], bool)


# --- PATCH opt-in persists all three fields ---
def test_patch_sms_optin_persists(headers):
    consent = datetime.now(timezone.utc).isoformat()
    payload = {
        "sms_enabled": True,
        "sms_phone": "+15551234567",
        "sms_consent_at": consent,
    }
    r = requests.patch(
        f"{BASE_URL}/api/notifications/preferences",
        headers=headers, json=payload, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sms_enabled"] is True
    assert body["sms_phone"] == "+15551234567"
    assert body["sms_consent_at"] == consent

    # Reload via GET
    r2 = requests.get(f"{BASE_URL}/api/notifications/preferences", headers=headers, timeout=20)
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["sms_enabled"] is True
    assert body2["sms_phone"] == "+15551234567"
    assert body2["sms_consent_at"] == consent


# --- PATCH opt-out sets sms_enabled=false but preserves phone ---
def test_patch_sms_optout(headers):
    r = requests.patch(
        f"{BASE_URL}/api/notifications/preferences",
        headers=headers, json={"sms_enabled": False}, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sms_enabled"] is False
    # phone should still be preserved from previous test
    assert body["sms_phone"] == "+15551234567"


# --- Other notification fields still work when patching SMS ---
def test_patch_sms_does_not_break_other_fields(headers):
    r = requests.patch(
        f"{BASE_URL}/api/notifications/preferences",
        headers=headers,
        json={"sms_enabled": True, "sms_phone": "+15559998888"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sms_enabled"] is True
    assert body["sms_phone"] == "+15559998888"
    # untouched fields remain
    assert "frequency" in body
    assert "categories" in body
    assert "expense_due" in body["categories"]


# --- Cleanup: reset to a clean state so subsequent test runs are idempotent ---
def test_zzz_cleanup_reset_sms(headers):
    r = requests.patch(
        f"{BASE_URL}/api/notifications/preferences",
        headers=headers,
        json={"sms_enabled": False, "sms_phone": None, "sms_consent_at": None},
        timeout=20,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["sms_enabled"] is False
    assert body["sms_phone"] is None
    assert body["sms_consent_at"] is None
