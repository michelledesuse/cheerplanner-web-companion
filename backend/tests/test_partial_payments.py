"""Partial payment / apply-payment feature pytest suite.

Tests new behavior introduced for partial payment on expense:
- GET /api/expenses returns paid_amount + balance_due
- POST /api/expenses/{id}/apply-payment (manual + fundraiser)
- GET /api/fundraisers returns applied_amount + available
- POST /api/payments only flips expense.paid when fully covered
- GET /api/dashboard.unpaid_expense_balance subtracts partial payments
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests


BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://dynamic-repaint-v108.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"


def _unique_email(prefix="TEST_pp"):
    return f"{prefix}_{uuid.uuid4().hex[:10]}@mailinator.com"


def _today_iso():
    return datetime.now(timezone.utc).date().isoformat()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user(session):
    email = _unique_email("TEST_pp")
    r = session.post(f"{API}/auth/signup", json={
        "email": email, "password": "password123", "name": "PP Tester"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["access_token"], "user": data["user"]}


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ----- helpers -----
def _create_athlete(session, token, name="A1"):
    r = session.post(f"{API}/athletes", json={"name": name}, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


def _create_expense(session, token, athlete_id, amount=400.0, category="Tuition", paid=False):
    r = session.post(f"{API}/expenses", json={
        "athlete_id": athlete_id, "category": category,
        "amount": amount, "incurred_on": _today_iso(), "paid": paid,
    }, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


def _create_fundraiser(session, token, athlete_id=None, name="Bake Sale", amount=20.0):
    body = {"name": name, "amount_raised": amount, "raised_on": _today_iso()}
    if athlete_id:
        body["athlete_id"] = athlete_id
    r = session.post(f"{API}/fundraisers", json=body, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


# ----- tests -----

class TestExpenseBalanceFields:
    """GET /api/expenses returns paid_amount and balance_due for each."""

    def test_fresh_expense_has_zero_paid_full_balance(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_balance")
        e = _create_expense(session, user["token"], a["id"], amount=300.0)
        r = session.get(f"{API}/expenses?athlete_id={a['id']}", headers=H(user["token"]))
        assert r.status_code == 200
        rows = r.json()
        mine = [x for x in rows if x["id"] == e["id"]]
        assert len(mine) == 1
        assert mine[0]["paid_amount"] == 0.0
        assert mine[0]["balance_due"] == 300.0
        assert mine[0]["paid"] is False

    def test_manually_paid_expense_has_balance_zero(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_balance2")
        e = _create_expense(session, user["token"], a["id"], amount=100.0, paid=True)
        r = session.get(f"{API}/expenses?athlete_id={a['id']}", headers=H(user["token"]))
        assert r.status_code == 200
        mine = [x for x in r.json() if x["id"] == e["id"]][0]
        assert mine["paid"] is True
        assert mine["balance_due"] == 0.0
        # paid_amount surfaces full amount even without explicit payment record
        assert mine["paid_amount"] == 100.0


class TestApplyPaymentFundraiserAndManual:
    """Core scenario from request: $20 fundraiser onto $400 tuition, then $380 manual."""

    def test_fundraiser_then_manual_full_cycle(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_cycle")
        e = _create_expense(session, user["token"], a["id"], amount=400.0)
        f = _create_fundraiser(session, user["token"], athlete_id=a["id"], amount=20.0)

        # Apply 20 from fundraiser
        r = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 20, "source_type": "fundraiser",
                  "fundraiser_id": f["id"], "paid_on": _today_iso(), "note": "test"},
            headers=H(user["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] == e["id"]
        assert body["paid_amount"] == 20.0
        assert body["balance_due"] == 380.0
        assert body["paid"] is False

        # Fundraiser applied_amount + available
        fr_list = session.get(f"{API}/fundraisers", headers=H(user["token"])).json()
        fr = [x for x in fr_list if x["id"] == f["id"]][0]
        assert fr["applied_amount"] == 20.0
        assert fr["available"] == 0.0

        # Apply remaining 380 via manual
        r2 = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 380, "source_type": "manual", "paid_on": _today_iso()},
            headers=H(user["token"]),
        )
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["paid_amount"] == 400.0
        assert body2["balance_due"] == 0.0
        assert body2["paid"] is True

        # Confirm via GET /expenses
        rows = session.get(f"{API}/expenses?athlete_id={a['id']}", headers=H(user["token"])).json()
        confirmed = [x for x in rows if x["id"] == e["id"]][0]
        assert confirmed["paid"] is True
        assert confirmed["balance_due"] == 0.0
        assert confirmed["paid_amount"] == 400.0


class TestApplyPaymentCaps:
    def test_cap_to_fundraiser_available(self, session, user):
        """Try to apply $50 when only $20 raised → capped to $20."""
        a = _create_athlete(session, user["token"], "TEST_capF")
        e = _create_expense(session, user["token"], a["id"], amount=400.0)
        f = _create_fundraiser(session, user["token"], athlete_id=a["id"], amount=20.0, name="Small")
        r = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 50, "source_type": "fundraiser",
                  "fundraiser_id": f["id"], "paid_on": _today_iso()},
            headers=H(user["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Should be capped to 20
        assert body["paid_amount"] == 20.0
        assert body["balance_due"] == 380.0
        # Fundraiser fully consumed
        fr = [x for x in session.get(f"{API}/fundraisers", headers=H(user["token"])).json() if x["id"] == f["id"]][0]
        assert fr["applied_amount"] == 20.0
        assert fr["available"] == 0.0

    def test_cap_to_remaining_balance(self, session, user):
        """Apply $500 manual to a $100 expense → only $100 actually applied."""
        a = _create_athlete(session, user["token"], "TEST_capR")
        e = _create_expense(session, user["token"], a["id"], amount=100.0)
        r = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 500, "source_type": "manual", "paid_on": _today_iso()},
            headers=H(user["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["paid_amount"] == 100.0
        assert body["balance_due"] == 0.0
        assert body["paid"] is True


class TestApplyPaymentValidation:
    def test_zero_amount_400(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_val0")
        e = _create_expense(session, user["token"], a["id"], amount=50.0)
        r = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 0, "source_type": "manual"},
            headers=H(user["token"]),
        )
        assert r.status_code == 400

    def test_negative_amount_400(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_valN")
        e = _create_expense(session, user["token"], a["id"], amount=50.0)
        r = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": -10, "source_type": "manual"},
            headers=H(user["token"]),
        )
        assert r.status_code == 400

    def test_nonexistent_expense_404(self, session, user):
        r = session.post(
            f"{API}/expenses/{uuid.uuid4()}/apply-payment",
            json={"amount": 10, "source_type": "manual"},
            headers=H(user["token"]),
        )
        assert r.status_code == 404

    def test_nonexistent_fundraiser_404(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_noF")
        e = _create_expense(session, user["token"], a["id"], amount=50.0)
        r = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 10, "source_type": "fundraiser",
                  "fundraiser_id": str(uuid.uuid4())},
            headers=H(user["token"]),
        )
        assert r.status_code == 404

    def test_fully_paid_expense_rejects_400(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_fp")
        # Create as already paid
        e = _create_expense(session, user["token"], a["id"], amount=50.0, paid=True)
        r = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 10, "source_type": "manual"},
            headers=H(user["token"]),
        )
        assert r.status_code == 400

    def test_fully_covered_then_apply_again_400(self, session, user):
        """Apply enough to fully cover, then a second apply should 400."""
        a = _create_athlete(session, user["token"], "TEST_again")
        e = _create_expense(session, user["token"], a["id"], amount=30.0)
        r1 = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 30, "source_type": "manual"},
            headers=H(user["token"]),
        )
        assert r1.status_code == 200
        assert r1.json()["paid"] is True
        r2 = session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 5, "source_type": "manual"},
            headers=H(user["token"]),
        )
        assert r2.status_code == 400


class TestFundraiserAppliedAvailable:
    def test_new_fundraiser_has_full_available(self, session, user):
        f = _create_fundraiser(session, user["token"], name="TEST_fresh_fund", amount=100.0)
        rows = session.get(f"{API}/fundraisers", headers=H(user["token"])).json()
        mine = [x for x in rows if x["id"] == f["id"]][0]
        assert mine["amount_raised"] == 100.0
        assert mine["applied_amount"] == 0.0
        assert mine["available"] == 100.0

    def test_partial_fundraiser_application_tracks(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_fa_track")
        e = _create_expense(session, user["token"], a["id"], amount=500.0)
        f = _create_fundraiser(session, user["token"], athlete_id=a["id"],
                               name="TEST_fa_track_fund", amount=200.0)
        # Apply 60
        session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 60, "source_type": "fundraiser", "fundraiser_id": f["id"]},
            headers=H(user["token"]),
        )
        # Apply another 40
        session.post(
            f"{API}/expenses/{e['id']}/apply-payment",
            json={"amount": 40, "source_type": "fundraiser", "fundraiser_id": f["id"]},
            headers=H(user["token"]),
        )
        fr = [x for x in session.get(f"{API}/fundraisers", headers=H(user["token"])).json() if x["id"] == f["id"]][0]
        assert fr["applied_amount"] == 100.0
        assert fr["available"] == 100.0


class TestPaymentsEndpointDoesNotEagerlyMark:
    """POST /api/payments — when applied_expense_ids provided, only flip paid if fully covered."""

    def test_partial_payment_does_not_mark_paid(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_eager")
        e = _create_expense(session, user["token"], a["id"], amount=200.0)
        r = session.post(f"{API}/payments", json={
            "athlete_id": a["id"], "amount": 50, "paid_on": _today_iso(),
            "applied_expense_ids": [e["id"]],
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text

        rows = session.get(f"{API}/expenses?athlete_id={a['id']}", headers=H(user["token"])).json()
        mine = [x for x in rows if x["id"] == e["id"]][0]
        assert mine["paid"] is False
        assert mine["paid_amount"] == 50.0
        assert mine["balance_due"] == 150.0

    def test_full_payment_marks_paid(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_eager_full")
        e = _create_expense(session, user["token"], a["id"], amount=75.0)
        r = session.post(f"{API}/payments", json={
            "athlete_id": a["id"], "amount": 75, "paid_on": _today_iso(),
            "applied_expense_ids": [e["id"]],
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = session.get(f"{API}/expenses?athlete_id={a['id']}", headers=H(user["token"])).json()
        mine = [x for x in rows if x["id"] == e["id"]][0]
        assert mine["paid"] is True
        assert mine["balance_due"] == 0.0


class TestDashboardUnpaidBalanceAccountsPartial:
    def test_partial_reduces_unpaid_expense_balance(self, session, user):
        # Use a freshly signed-up sub-user for clean dashboard math
        email = _unique_email("TEST_dash_pp")
        r = session.post(f"{API}/auth/signup", json={"email": email, "password": "password123"})
        assert r.status_code == 200
        token = r.json()["access_token"]

        a = _create_athlete(session, token, "TEST_dash")
        # Two unpaid expenses: 100 and 200
        e1 = _create_expense(session, token, a["id"], amount=100.0, category="Misc")
        _create_expense(session, token, a["id"], amount=200.0, category="Gear")

        # Baseline dashboard
        d0 = session.get(f"{API}/dashboard", headers=H(token)).json()
        assert d0["unpaid_expense_balance"] == 300.0

        # Apply 30 to e1
        rp = session.post(
            f"{API}/expenses/{e1['id']}/apply-payment",
            json={"amount": 30, "source_type": "manual"},
            headers=H(token),
        )
        assert rp.status_code == 200

        d1 = session.get(f"{API}/dashboard", headers=H(token)).json()
        # Now unpaid = (100-30) + 200 = 270
        assert d1["unpaid_expense_balance"] == 270.0

        # Apply remaining 70 to e1 → e1 fully paid
        rp2 = session.post(
            f"{API}/expenses/{e1['id']}/apply-payment",
            json={"amount": 70, "source_type": "manual"},
            headers=H(token),
        )
        assert rp2.status_code == 200
        assert rp2.json()["paid"] is True

        d2 = session.get(f"{API}/dashboard", headers=H(token)).json()
        # Only e2 remaining = 200
        assert d2["unpaid_expense_balance"] == 200.0
