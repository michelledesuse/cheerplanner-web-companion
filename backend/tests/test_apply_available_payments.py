"""
Tests for the new payment-allocation UX (CheerPlanner):
  • POST /api/payments/bulk no longer auto-allocates to oldest unpaid expenses.
  • POST /api/expenses/{expense_id}/apply-available-payments pulls leftover
    funds from this athlete's existing payments oldest-first.
  • Single POST /api/payments still auto-marks expenses paid when fully covered.
  • Regression on GET /api/dashboard, /api/expenses, /api/payments.

Uses smoke@test.com / password123 (creates the account if missing) and
isolates state by creating fresh athletes/expenses/payments per test class.
"""
import os
import uuid

import pytest
import requests

# Base URL comes from the frontend env so we hit through the public ingress.
BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://athlete-expense-hub.preview.emergentagent.com"
).rstrip("/")

EMAIL = "smoke@test.com"
PASSWORD = "password123"


# ------------------------------ fixtures ------------------------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # try login, fall back to signup
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        r2 = s.post(
            f"{BASE_URL}/api/auth/signup",
            json={"email": EMAIL, "password": PASSWORD, "name": "Smoke"},
        )
        assert r2.status_code == 200, f"Auth setup failed: {r.text} / {r2.text}"
        token = r2.json()["access_token"]
    else:
        token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture
def athlete(session):
    """Create a throwaway athlete; clean up at the end (cascades expenses+payments)."""
    name = f"TEST_{uuid.uuid4().hex[:8]}"
    r = session.post(f"{BASE_URL}/api/athletes", json={"name": name, "team": "T"})
    assert r.status_code == 200, r.text
    a = r.json()
    yield a
    session.delete(f"{BASE_URL}/api/athletes/{a['id']}")


def _make_expense(session, athlete_id, amount, incurred_on="2026-01-05", category="Tuition"):
    r = session.post(
        f"{BASE_URL}/api/expenses",
        json={
            "athlete_id": athlete_id,
            "category": category,
            "amount": amount,
            "incurred_on": incurred_on,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()[0]


def _get_expense(session, expense_id):
    r = session.get(f"{BASE_URL}/api/expenses")
    assert r.status_code == 200
    return next((e for e in r.json() if e["id"] == expense_id), None)


def _get_payment(session, payment_id):
    r = session.get(f"{BASE_URL}/api/payments")
    assert r.status_code == 200
    return next((p for p in r.json() if p["id"] == payment_id), None)


# ============================================================
# 1. /api/payments/bulk must NOT auto-allocate to existing expenses
# ============================================================
class TestBulkPaymentsNoAutoAllocate:
    def test_bulk_payment_creates_unallocated_and_keeps_expense_unpaid(self, session, athlete):
        # Pre-existing unpaid expense
        exp = _make_expense(session, athlete["id"], 100.0, incurred_on="2026-01-01")
        assert exp["paid"] is False
        assert exp["balance_due"] == 100.0

        # Bulk payment for that athlete
        r = session.post(
            f"{BASE_URL}/api/payments/bulk",
            json={
                "athlete_ids": [athlete["id"]],
                "amount": 60.0,
                "split_mode": "same",
                "paid_on": "2026-01-10",
                "method": "Card",
            },
        )
        assert r.status_code == 200, r.text
        payments = r.json()
        assert len(payments) == 1
        p = payments[0]
        # No auto-allocation
        assert p["applied_expense_ids"] == [], f"expected empty applied_expense_ids, got {p['applied_expense_ids']}"
        assert p.get("allocations") in (None, []), f"expected None allocations, got {p.get('allocations')}"
        assert p["amount"] == 60.0
        assert p["athlete_id"] == athlete["id"]

        # GET payments confirms persistence with empty applied_expense_ids
        fetched = _get_payment(session, p["id"])
        assert fetched is not None
        assert fetched["applied_expense_ids"] == []

        # Pre-existing expense remains unpaid w/ unchanged balance
        exp_after = _get_expense(session, exp["id"])
        assert exp_after is not None
        assert exp_after["paid"] is False
        assert exp_after["balance_due"] == 100.0
        assert exp_after["paid_amount"] == 0.0

    def test_bulk_payment_multi_athlete_equal_split(self, session, athlete):
        # second athlete (also cleaned up since test fn-scoped athlete fixture creates one;
        # we make another inline and clean up manually)
        r = session.post(f"{BASE_URL}/api/athletes", json={"name": f"TEST_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200
        a2 = r.json()
        try:
            r = session.post(
                f"{BASE_URL}/api/payments/bulk",
                json={
                    "athlete_ids": [athlete["id"], a2["id"]],
                    "amount": 200.0,
                    "split_mode": "equal",
                    "paid_on": "2026-01-12",
                },
            )
            assert r.status_code == 200, r.text
            payments = r.json()
            assert len(payments) == 2
            for p in payments:
                assert p["amount"] == 100.0
                assert p["applied_expense_ids"] == []
                assert p.get("allocations") in (None, [])
        finally:
            session.delete(f"{BASE_URL}/api/athletes/{a2['id']}")


# ============================================================
# 2. /api/expenses/{id}/apply-available-payments
# ============================================================
class TestApplyAvailablePayments:
    def test_pulls_leftover_funds_oldest_first(self, session, athlete):
        # Create 2 payments (oldest first), no allocations
        p1 = session.post(
            f"{BASE_URL}/api/payments/bulk",
            json={
                "athlete_ids": [athlete["id"]],
                "amount": 40.0,
                "split_mode": "same",
                "paid_on": "2026-01-01",
            },
        ).json()[0]
        p2 = session.post(
            f"{BASE_URL}/api/payments/bulk",
            json={
                "athlete_ids": [athlete["id"]],
                "amount": 70.0,
                "split_mode": "same",
                "paid_on": "2026-01-05",
            },
        ).json()[0]
        exp = _make_expense(session, athlete["id"], 100.0)

        r = session.post(f"{BASE_URL}/api/expenses/{exp['id']}/apply-available-payments")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["applied"] == 100.0
        assert data["balance_due"] == 0.0
        assert data["payments_touched"] == 2

        # p1 consumed fully (40), p2 consumed 60 (30 left)
        p1_after = _get_payment(session, p1["id"])
        p2_after = _get_payment(session, p2["id"])
        assert exp["id"] in p1_after["applied_expense_ids"]
        assert exp["id"] in p2_after["applied_expense_ids"]
        allocs1 = {a["expense_id"]: a["amount"] for a in (p1_after.get("allocations") or [])}
        allocs2 = {a["expense_id"]: a["amount"] for a in (p2_after.get("allocations") or [])}
        assert allocs1.get(exp["id"]) == 40.0
        assert allocs2.get(exp["id"]) == 60.0

        # Expense flipped to paid=True
        exp_after = _get_expense(session, exp["id"])
        assert exp_after["paid"] is True
        assert exp_after["balance_due"] == 0.0

    def test_partial_coverage_does_not_flip_paid(self, session, athlete):
        # 30 available, expense 100 → partial
        session.post(
            f"{BASE_URL}/api/payments/bulk",
            json={"athlete_ids": [athlete["id"]], "amount": 30.0,
                  "split_mode": "same", "paid_on": "2026-01-01"},
        )
        exp = _make_expense(session, athlete["id"], 100.0)
        r = session.post(f"{BASE_URL}/api/expenses/{exp['id']}/apply-available-payments")
        assert r.status_code == 200
        data = r.json()
        assert data["applied"] == 30.0
        assert data["balance_due"] == 70.0
        assert data["payments_touched"] == 1
        exp_after = _get_expense(session, exp["id"])
        assert exp_after["paid"] is False
        assert exp_after["balance_due"] == 70.0
        assert exp_after["paid_amount"] == 30.0

    def test_no_payments_returns_zero(self, session, athlete):
        exp = _make_expense(session, athlete["id"], 50.0)
        r = session.post(f"{BASE_URL}/api/expenses/{exp['id']}/apply-available-payments")
        assert r.status_code == 200
        data = r.json()
        assert data["applied"] == 0
        assert data["payments_touched"] == 0
        # Expense untouched
        exp_after = _get_expense(session, exp["id"])
        assert exp_after["paid"] is False
        assert exp_after["balance_due"] == 50.0

    def test_no_leftover_funds_returns_zero(self, session, athlete):
        # Create expense + single payment that already covers it via applied_expense_ids
        exp = _make_expense(session, athlete["id"], 50.0)
        r = session.post(
            f"{BASE_URL}/api/payments",
            json={
                "athlete_id": athlete["id"],
                "amount": 50.0,
                "paid_on": "2026-01-02",
                "applied_expense_ids": [exp["id"]],
            },
        )
        assert r.status_code == 200, r.text

        # Now create a *second* unpaid expense; apply-available should find no free funds
        exp2 = _make_expense(session, athlete["id"], 25.0, incurred_on="2026-01-15")
        r = session.post(f"{BASE_URL}/api/expenses/{exp2['id']}/apply-available-payments")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["applied"] == 0
        assert data["payments_touched"] == 0

    def test_balance_zero_returns_zero(self, session, athlete):
        # Already-paid expense (manually marked)
        exp = _make_expense(session, athlete["id"], 20.0)
        session.patch(f"{BASE_URL}/api/expenses/{exp['id']}", json={"paid": True})
        # Also add a payment so leftover funds exist on the athlete
        session.post(
            f"{BASE_URL}/api/payments/bulk",
            json={"athlete_ids": [athlete["id"]], "amount": 50.0,
                  "split_mode": "same", "paid_on": "2026-01-03"},
        )
        r = session.post(f"{BASE_URL}/api/expenses/{exp['id']}/apply-available-payments")
        assert r.status_code == 200
        data = r.json()
        assert data["applied"] == 0
        assert data["balance_due"] == 0.0
        assert data["payments_touched"] == 0

    def test_idempotent_second_call_zero(self, session, athlete):
        session.post(
            f"{BASE_URL}/api/payments/bulk",
            json={"athlete_ids": [athlete["id"]], "amount": 100.0,
                  "split_mode": "same", "paid_on": "2026-01-01"},
        )
        exp = _make_expense(session, athlete["id"], 80.0)
        first = session.post(
            f"{BASE_URL}/api/expenses/{exp['id']}/apply-available-payments"
        ).json()
        assert first["applied"] == 80.0
        assert first["balance_due"] == 0.0

        second = session.post(
            f"{BASE_URL}/api/expenses/{exp['id']}/apply-available-payments"
        ).json()
        assert second["applied"] == 0, f"Second call double-applied: {second}"
        assert second["balance_due"] == 0.0
        assert second["payments_touched"] == 0


# ============================================================
# 3. Single POST /api/payments still behaves as before
# ============================================================
class TestSinglePaymentUnchanged:
    def test_payment_with_applied_expense_ids_marks_paid(self, session, athlete):
        exp = _make_expense(session, athlete["id"], 75.0)
        r = session.post(
            f"{BASE_URL}/api/payments",
            json={
                "athlete_id": athlete["id"],
                "amount": 75.0,
                "paid_on": "2026-01-10",
                "applied_expense_ids": [exp["id"]],
            },
        )
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["applied_expense_ids"] == [exp["id"]]
        exp_after = _get_expense(session, exp["id"])
        assert exp_after["paid"] is True
        assert exp_after["balance_due"] == 0.0

    def test_partial_payment_does_not_mark_paid(self, session, athlete):
        exp = _make_expense(session, athlete["id"], 100.0)
        r = session.post(
            f"{BASE_URL}/api/payments",
            json={
                "athlete_id": athlete["id"],
                "amount": 40.0,
                "paid_on": "2026-01-10",
                "applied_expense_ids": [exp["id"]],
            },
        )
        assert r.status_code == 200
        exp_after = _get_expense(session, exp["id"])
        assert exp_after["paid"] is False
        assert exp_after["paid_amount"] == 40.0
        assert exp_after["balance_due"] == 60.0


# ============================================================
# 4. Regression: GET /api/dashboard, /api/expenses, /api/payments
# ============================================================
class TestRegression:
    def test_dashboard_balance_does_not_drop_after_bulk_payment(self, session, athlete):
        exp = _make_expense(session, athlete["id"], 250.0)
        before = session.get(f"{BASE_URL}/api/dashboard").json()
        bal_before = before["unpaid_expense_balance"]
        assert bal_before >= 250.0

        # Bulk payment should NOT auto-allocate, so unpaid balance shouldn't drop
        session.post(
            f"{BASE_URL}/api/payments/bulk",
            json={
                "athlete_ids": [athlete["id"]],
                "amount": 100.0,
                "split_mode": "same",
                "paid_on": "2026-01-10",
            },
        )
        after = session.get(f"{BASE_URL}/api/dashboard").json()
        assert after["unpaid_expense_balance"] >= bal_before - 0.01, (
            f"Bulk payment unexpectedly reduced unpaid balance: {bal_before} -> {after['unpaid_expense_balance']}"
        )
        # And total_payments_ytd should have increased by 100
        assert round(after["total_payments_ytd"] - before["total_payments_ytd"], 2) >= 100.0

        # Expense still unpaid
        exp_after = _get_expense(session, exp["id"])
        assert exp_after["paid"] is False
        assert exp_after["balance_due"] == 250.0

    def test_lists_endpoints_return_200(self, session):
        for path in ("/api/expenses", "/api/payments", "/api/dashboard"):
            r = session.get(f"{BASE_URL}{path}")
            assert r.status_code == 200, f"{path} → {r.status_code} {r.text}"


# ============================================================
# 5. Household scoping — endpoint accepts payments from any household member
# ============================================================
class TestHouseholdScoping:
    """Sanity: endpoint accepts a household member's payment.

    Without a second user we can't perfectly verify cross-user behavior,
    but we can verify the endpoint uses household scope (member_ids list)
    rather than just the calling user — the underlying find queries
    {"user_id": {"$in": member_ids}} which includes the caller.
    """
    def test_endpoint_uses_household_scope_for_caller(self, session, athlete):
        # Single member household is just the caller; this just confirms the
        # endpoint works end-to-end (path mostly covered above).
        session.post(
            f"{BASE_URL}/api/payments/bulk",
            json={"athlete_ids": [athlete["id"]], "amount": 20.0,
                  "split_mode": "same", "paid_on": "2026-01-01"},
        )
        exp = _make_expense(session, athlete["id"], 15.0)
        r = session.post(f"{BASE_URL}/api/expenses/{exp['id']}/apply-available-payments")
        assert r.status_code == 200
        data = r.json()
        assert data["applied"] == 15.0
        assert data["balance_due"] == 0.0
        assert data["payments_touched"] == 1
