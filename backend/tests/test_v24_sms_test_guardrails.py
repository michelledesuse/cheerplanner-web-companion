"""Backend tests for v2.4 Twilio SMS send helpers + /notifications/sms-test guardrails.

IMPORTANT: These tests must NEVER trigger a real SMS send. We only exercise:
  * the 400 "Turn on SMS reminders first." path (user NOT opted in)
  * confirmation that Twilio IS configured (so we get 400, not 503)
  * unit-style tests of normalize_us_phone and _build_sms_body
  * regression: GET/PATCH /api/notifications/preferences round-trip SMS fields
    without ever setting sms_enabled=True (so scheduler + sms-test remain safe).
"""
import os
import sys
import pytest
import requests

# Make backend package importable when running from /app.
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://event-planner-394.preview.emergentagent.com"

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


# ---------- shared login fixture ----------
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


# ---------- Guardrail: applereview is NOT opted in — ensure it stays that way ----------
def test_precondition_applereview_not_opted_in(headers):
    """We must not accidentally test against an opted-in account."""
    r = requests.get(f"{BASE_URL}/api/notifications/preferences", headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("sms_enabled") is False, (
        f"applereview account is opted in (sms_enabled={data.get('sms_enabled')}); "
        "refusing to run guardrail tests to avoid a real SMS send."
    )


# ---------- Core guardrail: /notifications/sms-test returns 400 when not opted in ----------
def test_sms_test_returns_400_when_not_opted_in(headers):
    r = requests.post(f"{BASE_URL}/api/notifications/sms-test", headers=headers, timeout=20)
    # Must be 400 (not 503) — this implicitly proves is_configured() is True.
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("detail") == "Turn on SMS reminders first.", body


def test_sms_test_is_not_503_meaning_twilio_is_configured(headers):
    """Explicit check: the endpoint must not return 503. If it does, Twilio env
    is missing and the guardrail can't be tested."""
    r = requests.post(f"{BASE_URL}/api/notifications/sms-test", headers=headers, timeout=20)
    assert r.status_code != 503, (
        "sms-test returned 503 — Twilio (SID/token/from) is not configured server-side."
    )


def test_sms_test_requires_auth():
    r = requests.post(f"{BASE_URL}/api/notifications/sms-test", timeout=20)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"


# ---------- Unit tests: normalize_us_phone ----------
class TestNormalizeUsPhone:
    def test_pretty_formatted(self):
        from core.sms import normalize_us_phone
        assert normalize_us_phone("(844) 697-7111") == "+18446977111"

    def test_bare_10_digits(self):
        from core.sms import normalize_us_phone
        assert normalize_us_phone("8446977111") == "+18446977111"

    def test_e164_input(self):
        from core.sms import normalize_us_phone
        assert normalize_us_phone("+18446977111") == "+18446977111"

    def test_garbage(self):
        from core.sms import normalize_us_phone
        assert normalize_us_phone("bad") is None

    def test_none_and_empty(self):
        from core.sms import normalize_us_phone
        assert normalize_us_phone(None) is None
        assert normalize_us_phone("") is None

    def test_leading_1_11_digits(self):
        from core.sms import normalize_us_phone
        assert normalize_us_phone("18446977111") == "+18446977111"


# ---------- Unit tests: _build_sms_body ----------
class TestBuildSmsBody:
    def test_body_shape_with_items(self):
        from core.scheduler import _build_sms_body
        sections = [
            {"title": "Payments due", "items": [
                {"title": "Tuition", "amount": "$150.00", "when": "Today"},
                {"title": "Gear", "amount": "$45.00", "when": "Tomorrow"},
            ]},
            {"title": "Upcoming competitions", "items": [
                {"title": "Regionals", "when": "Sat Feb 1"},
                {"title": "State", "when": "Sat Feb 8"},
            ]},
        ]
        total = sum(len(s["items"]) for s in sections)
        body = _build_sms_body(sections, total)
        assert "CheerPlanner:" in body
        assert "Reply STOP to opt out." in body
        # Up to 3 item lines
        item_lines = [ln for ln in body.split("\n") if ln.startswith("- ")]
        assert len(item_lines) <= 3
        assert len(item_lines) == 3
        # "...and N more." tail when total > 3
        assert "...and 1 more" in body

    def test_body_singular_count(self):
        from core.scheduler import _build_sms_body
        sections = [{"title": "X", "items": [{"title": "One", "when": "Today"}]}]
        body = _build_sms_body(sections, 1)
        assert "1 upcoming reminder." in body  # singular
        assert body.count("\n- ") == 1
        assert body.rstrip().endswith("Reply STOP to opt out.")

    def test_body_no_amount_no_when(self):
        from core.scheduler import _build_sms_body
        sections = [{"title": "X", "items": [{"title": "NoDetails"}]}]
        body = _build_sms_body(sections, 1)
        assert "- NoDetails" in body


# ---------- Regression: GET/PATCH prefs SMS fields WITHOUT enabling ----------
def test_prefs_get_returns_sms_shape(headers):
    r = requests.get(f"{BASE_URL}/api/notifications/preferences", headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("sms_enabled", "sms_phone", "sms_consent_at"):
        assert k in data
    assert isinstance(data["sms_enabled"], bool)


def test_prefs_patch_phone_without_opt_in_roundtrip(headers):
    """Save an obviously non-deliverable 555 number WITHOUT flipping sms_enabled=True.
    This keeps applereview NOT opted in, so the scheduler and sms-test remain safe.
    """
    # Reserved 555-01xx range is guaranteed non-routable per NANP.
    payload = {"sms_phone": "+15550100"}  # deliberately short/invalid to prove storage
    r = requests.patch(
        f"{BASE_URL}/api/notifications/preferences",
        headers=headers, json=payload, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sms_phone"] == "+15550100"
    assert body["sms_enabled"] is False  # still opted out

    # GET verifies persistence
    r2 = requests.get(f"{BASE_URL}/api/notifications/preferences", headers=headers, timeout=20)
    assert r2.status_code == 200
    assert r2.json()["sms_phone"] == "+15550100"


def test_prefs_patch_consent_at_roundtrip(headers):
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).isoformat()
    r = requests.patch(
        f"{BASE_URL}/api/notifications/preferences",
        headers=headers, json={"sms_consent_at": ts}, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sms_consent_at"] == ts
    assert body["sms_enabled"] is False  # still opted out


# ---------- Cleanup: reset SMS fields, keep opted OUT ----------
def test_zzz_cleanup_reset_sms(headers):
    r = requests.patch(
        f"{BASE_URL}/api/notifications/preferences",
        headers=headers,
        json={"sms_enabled": False, "sms_phone": None, "sms_consent_at": None},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sms_enabled"] is False
    assert body["sms_phone"] is None
    assert body["sms_consent_at"] is None
