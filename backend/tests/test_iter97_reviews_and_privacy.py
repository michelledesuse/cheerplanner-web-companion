"""Iter97 — verify guidelines gating on POST /api/reviews and dashboard privacy flags."""
import os
import secrets
import time
import requests
import pytest

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://event-planner-394.preview.emergentagent.com').rstrip('/')


def _signup():
    email = f"TEST_iter97_{secrets.token_hex(4)}@cheerplanner.app"
    pw = "Passw0rd!"
    r = requests.post(f"{BASE_URL}/api/auth/signup", json={"email": email, "password": pw, "name": "Iter97 Tester"})
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    return r.json()["access_token"], email


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed: {r.text}"
    return r.json()["access_token"]


class TestGuidelinesGate:
    """BUG 1: guidelines gate on POST /api/reviews"""

    def test_new_user_review_returns_403_guidelines(self):
        token, _ = _signup()
        h = {"Authorization": f"Bearer {token}"}
        # Verify /reviews/categories reports guidelines_accepted=false
        r = requests.get(f"{BASE_URL}/api/reviews/categories", headers=h)
        assert r.status_code == 200
        assert r.json().get("guidelines_accepted") is False

        payload = {
            "place_name": f"TEST_Place_{secrets.token_hex(3)}",
            "city": "Dallas, TX",
            "category": "Restaurants/Eateries",
            "rating": 5,
            "body": "Delicious tacos.",
            "display_mode": "name",
            "photos": [],
        }
        r = requests.post(f"{BASE_URL}/api/reviews", json=payload, headers=h)
        assert r.status_code == 403
        assert r.json().get("detail") == "guidelines_not_accepted"

    def test_accept_then_post_succeeds_first_try(self):
        token, _ = _signup()
        h = {"Authorization": f"Bearer {token}"}
        r = requests.post(f"{BASE_URL}/api/reviews/accept-guidelines", headers=h)
        assert r.status_code == 200
        assert r.json().get("accepted") is True

        # Now POST should succeed without re-prompting
        payload = {
            "place_name": f"TEST_Place_{secrets.token_hex(3)}",
            "city": "Dallas, TX",
            "category": "Restaurants/Eateries",
            "rating": 4,
            "body": "Good spot.",
            "display_mode": "name",
            "photos": [],
        }
        r = requests.post(f"{BASE_URL}/api/reviews", json=payload, headers=h)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("place_id")
        assert data.get("review_id")

        # And /categories now reports guidelines_accepted=true
        r = requests.get(f"{BASE_URL}/api/reviews/categories", headers=h)
        assert r.json().get("guidelines_accepted") is True


class TestDashboardPrivacyFlags:
    """BUG 2: dashboard exposes can_view_expenses/can_view_travel and zeroes hidden values."""

    def test_owner_and_member_expense_toggle(self):
        # Owner
        owner_token = _login("applereview@cheerplanner.app", "Review2026!")
        oh = {"Authorization": f"Bearer {owner_token}"}

        # Create invite
        r = requests.post(f"{BASE_URL}/api/household/invite", headers=oh)
        assert r.status_code == 200, r.text
        code = r.json()["code"]

        # Second user joins
        member_token, member_email = _signup()
        mh = {"Authorization": f"Bearer {member_token}"}
        r = requests.post(f"{BASE_URL}/api/household/join", json={"code": code}, headers=mh)
        assert r.status_code == 200, r.text

        # Get member's user_id
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=mh)
        assert r.status_code == 200
        member_id = r.json()["id"]

        # baseline: member dashboard has can_view_expenses True
        r = requests.get(f"{BASE_URL}/api/dashboard", headers=mh)
        assert r.status_code == 200
        d = r.json()
        assert d.get("can_view_expenses") is True
        assert d.get("can_view_travel") is True

        # Owner turns OFF expenses
        r = requests.patch(f"{BASE_URL}/api/household/privacy/{member_id}", json={"expenses": False}, headers=oh)
        assert r.status_code == 200, r.text
        assert r.json()["privacy"]["expenses"] is False

        # Member sees can_view_expenses=false and financial fields zeroed
        r = requests.get(f"{BASE_URL}/api/dashboard", headers=mh)
        d = r.json()
        assert d["can_view_expenses"] is False
        assert d["month_spend"] == 0.0
        assert d["total_payments_ytd"] == 0.0
        assert d["total_expenses_ytd"] == 0.0
        assert d["unpaid_expense_balance"] == 0.0

        # Owner turns ON expenses
        r = requests.patch(f"{BASE_URL}/api/household/privacy/{member_id}", json={"expenses": True}, headers=oh)
        assert r.status_code == 200
        assert r.json()["privacy"]["expenses"] is True

        # Member sees can_view_expenses=true again
        r = requests.get(f"{BASE_URL}/api/dashboard", headers=mh)
        d = r.json()
        assert d["can_view_expenses"] is True, "Repopulation broken: can_view_expenses should be True after re-enable"

        # Cleanup — member leaves household so subsequent runs work
        r = requests.post(f"{BASE_URL}/api/household/leave", headers=mh)
        assert r.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
