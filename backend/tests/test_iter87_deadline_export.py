"""Iteration 87 — Team Forms deadline (close_at) auto-lock backend tests.

Verifies:
  1. Setting close_at to a PAST time auto-locks the form on next GET.
  2. Setting close_at to a FUTURE time leaves the form unlocked, and close_at
     is returned on GET.
  3. Public share endpoint (/api/public/share/{token}/data) reflects locked=true
     and includes close_at after auto-lock.
  4. Public submit returns HTTP 400 when the form is auto-locked.

Uses a throwaway TEST_ form so 'Banquet Meal' is not touched.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in login response: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def test_form(auth_session):
    """Create a throwaway TEST_ form; delete on teardown."""
    payload = {
        "name": "TEST_iter87_deadline",
        "description": "auto-lock test",
        "questions": [{"label": "Meal", "type": "choice", "options": ["A", "B"], "required": False, "order": 0}],
    }
    r = auth_session.post(f"{BASE_URL}/api/team/forms", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    form = r.json()
    yield form
    # cleanup
    auth_session.delete(f"{BASE_URL}/api/team/forms/{form['id']}", timeout=20)


# ---------- deadline auto-lock ----------
class TestDeadlineAutoLock:
    def test_future_deadline_stays_unlocked(self, auth_session, test_form):
        future = (datetime.now(timezone.utc) + timedelta(days=7)).replace(microsecond=0).isoformat()
        r = auth_session.patch(f"{BASE_URL}/api/team/forms/{test_form['id']}", json={"close_at": future}, timeout=20)
        assert r.status_code == 200, r.text
        # PATCH response should also be unlocked (patch path doesn't re-run autolock, but it echoes _detail).
        # Fetch fresh GET which is the contract that runs apply_form_autolock.
        g = auth_session.get(f"{BASE_URL}/api/team/forms/{test_form['id']}", timeout=20)
        assert g.status_code == 200, g.text
        doc = g.json()
        assert doc.get("locked") is False, f"expected locked=False, got {doc.get('locked')}"
        assert doc.get("close_at"), "close_at missing on GET"
        # ISO strings — starts-with prefix comparison is enough
        assert str(doc["close_at"]).startswith(future[:10]), f"close_at mismatch: {doc['close_at']} vs {future}"

    def test_past_deadline_autolocks_on_get(self, auth_session, test_form):
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(microsecond=0).isoformat()
        r = auth_session.patch(f"{BASE_URL}/api/team/forms/{test_form['id']}", json={"close_at": past}, timeout=20)
        assert r.status_code == 200, r.text
        g = auth_session.get(f"{BASE_URL}/api/team/forms/{test_form['id']}", timeout=20)
        assert g.status_code == 200, g.text
        doc = g.json()
        assert doc.get("locked") is True, f"expected locked=True after past deadline, got {doc.get('locked')}"


# ---------- public share reflects lock + submit blocked ----------
class TestPublicShareAutoLock:
    def _get_or_create_share(self, auth_session, form_id):
        r = auth_session.post(f"{BASE_URL}/api/team/share", json={"kind": "form", "ref_id": form_id}, timeout=20)
        assert r.status_code == 200, r.text
        tok = r.json().get("token")
        assert tok
        return tok

    def test_public_data_reports_locked_and_close_at(self, auth_session, test_form):
        # ensure past deadline (test may run in any order)
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(microsecond=0).isoformat()
        auth_session.patch(f"{BASE_URL}/api/team/forms/{test_form['id']}", json={"close_at": past}, timeout=20)
        # trigger autolock
        auth_session.get(f"{BASE_URL}/api/team/forms/{test_form['id']}", timeout=20)

        token = self._get_or_create_share(auth_session, test_form["id"])
        pub = requests.get(f"{BASE_URL}/api/public/share/{token}/data", timeout=20)
        assert pub.status_code == 200, pub.text
        j = pub.json()
        assert j.get("kind") == "form"
        assert j.get("locked") is True, f"public data should report locked=True, got {j.get('locked')}"
        assert j.get("close_at"), "public data missing close_at"

    def test_public_submit_returns_400_when_locked(self, auth_session, test_form):
        # ensure past deadline
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(microsecond=0).isoformat()
        auth_session.patch(f"{BASE_URL}/api/team/forms/{test_form['id']}", json={"close_at": past}, timeout=20)
        auth_session.get(f"{BASE_URL}/api/team/forms/{test_form['id']}", timeout=20)

        token = self._get_or_create_share(auth_session, test_form["id"])
        # need a valid roster member id for the payload
        detail = auth_session.get(f"{BASE_URL}/api/team/forms/{test_form['id']}", timeout=20).json()
        members = detail.get("members") or []
        assert members, "no roster members returned"
        member_id = members[0]["id"]

        submit = requests.post(
            f"{BASE_URL}/api/public/share/{token}/submit",
            json={"member_id": member_id, "answers": {}},
            timeout=20,
        )
        assert submit.status_code == 400, f"expected 400 on locked submit, got {submit.status_code} {submit.text}"


# ---------- clear deadline ----------
class TestClearDeadline:
    def test_clear_close_at(self, auth_session, test_form):
        # First unlock (since previous tests may have auto-locked)
        auth_session.patch(f"{BASE_URL}/api/team/forms/{test_form['id']}", json={"locked": False}, timeout=20)
        r = auth_session.patch(f"{BASE_URL}/api/team/forms/{test_form['id']}", json={"close_at": ""}, timeout=20)
        assert r.status_code == 200, r.text
        g = auth_session.get(f"{BASE_URL}/api/team/forms/{test_form['id']}", timeout=20).json()
        assert g.get("close_at") in (None, ""), f"expected close_at cleared, got {g.get('close_at')}"
        assert g.get("locked") is False
