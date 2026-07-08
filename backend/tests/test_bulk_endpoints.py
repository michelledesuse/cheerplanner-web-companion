"""Bulk endpoints pytest suite.

Tests POST /api/expenses/bulk and POST /api/payments/bulk plus related
edge cases (single-endpoint regression + ApplyPaymentRequest Literal strict).
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests


BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://athlete-expense-hub.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"


def _unique_email(prefix="TEST_bulk"):
    return f"{prefix}_{uuid.uuid4().hex[:10]}@mailinator.com"


def _today_iso():
    return datetime.now(timezone.utc).date().isoformat()


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ----- fixtures -----
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user(session):
    email = _unique_email("TEST_bulk")
    r = session.post(f"{API}/auth/signup", json={
        "email": email, "password": "password123", "name": "Bulk Tester"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["access_token"], "user": data["user"]}


@pytest.fixture(scope="module")
def user2(session):
    email = _unique_email("TEST_bulk_other")
    r = session.post(f"{API}/auth/signup", json={
        "email": email, "password": "password123", "name": "Bulk Other"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["access_token"], "user": data["user"]}


def _create_athlete(session, token, name):
    r = session.post(f"{API}/athletes", json={"name": name}, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


# ----- tests -----

class TestBulkExpenses:
    """POST /api/expenses/bulk scenarios."""

    def test_bulk_equal_split_3_athletes(self, session, user):
        ids = [_create_athlete(session, user["token"], f"TEST_eq_{i}")["id"] for i in range(3)]
        r = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": ids,
            "category": "Tuition",
            "amount": 300.0,
            "split_mode": "equal",
            "incurred_on": _today_iso(),
            "note": "TEST_bulk_equal",
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 3
        assert all(e["amount"] == 100.0 for e in rows), rows
        assert sum(e["amount"] for e in rows) == 300.0
        # Each expense maps to its athlete
        assert sorted([e["athlete_id"] for e in rows]) == sorted(ids)
        # Verify persistence: GET expenses for each athlete
        for aid in ids:
            got = session.get(f"{API}/expenses?athlete_id={aid}",
                              headers=H(user["token"])).json()
            mine = [x for x in got if x["category"] == "Tuition" and x["amount"] == 100.0]
            assert len(mine) >= 1

    def test_bulk_same_split_3_athletes(self, session, user):
        ids = [_create_athlete(session, user["token"], f"TEST_sm_{i}")["id"] for i in range(3)]
        r = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": ids,
            "category": "Camp",
            "amount": 100.0,
            "split_mode": "same",
            "incurred_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 3
        assert all(e["amount"] == 100.0 for e in rows), rows
        assert sum(e["amount"] for e in rows) == 300.0

    def test_bulk_single_athlete_equal(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_single_eq")
        r = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": [a["id"]],
            "category": "Gear",
            "amount": 200.0,
            "split_mode": "equal",
            "incurred_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 1
        assert rows[0]["amount"] == 200.0
        assert rows[0]["athlete_id"] == a["id"]

    def test_bulk_empty_athlete_ids_400(self, session, user):
        r = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": [],
            "category": "Tuition",
            "amount": 100.0,
            "split_mode": "equal",
            "incurred_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 400, r.text

    def test_bulk_zero_amount_400(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_zero")
        r = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": [a["id"]],
            "category": "Tuition",
            "amount": 0,
            "split_mode": "equal",
            "incurred_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 400, r.text

    def test_bulk_negative_amount_400(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_neg")
        r = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": [a["id"]],
            "category": "Tuition",
            "amount": -50.0,
            "split_mode": "equal",
            "incurred_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 400, r.text

    def test_bulk_cross_user_athlete_404(self, session, user, user2):
        # Athlete belongs to user2; user attempts bulk with that id
        other_a = _create_athlete(session, user2["token"], "TEST_other_user_ath")
        r = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": [other_a["id"]],
            "category": "Tuition",
            "amount": 100.0,
            "split_mode": "equal",
            "incurred_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 404, r.text
        detail = r.json().get("detail", "")
        assert other_a["id"] in str(detail), f"Expected detail to mention missing id, got: {detail}"

    def test_bulk_per_athlete_rounds_to_zero_400(self, session, user):
        ids = [_create_athlete(session, user["token"], f"TEST_round_{i}")["id"] for i in range(3)]
        # 0.001 / 3 ~ 0.000333 → round(_, 2) = 0.0 → per-athlete rounds to 0
        r = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": ids,
            "category": "Misc",
            "amount": 0.001,
            "split_mode": "equal",
            "incurred_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 400, r.text

    def test_bulk_increases_dashboard_unpaid_balance(self, session):
        # Use a fresh user so dashboard math is deterministic
        email = _unique_email("TEST_bulk_dash")
        r = session.post(f"{API}/auth/signup", json={
            "email": email, "password": "password123", "name": "Bulk Dash"
        })
        assert r.status_code == 200
        token = r.json()["access_token"]

        ids = [_create_athlete(session, token, f"TEST_dash_{i}")["id"] for i in range(3)]
        # Baseline dashboard
        d0 = session.get(f"{API}/dashboard", headers=H(token)).json()
        before = float(d0.get("unpaid_expense_balance", 0.0))

        # Bulk 300 equal
        r2 = session.post(f"{API}/expenses/bulk", json={
            "athlete_ids": ids,
            "category": "Tuition",
            "amount": 300.0,
            "split_mode": "equal",
            "incurred_on": _today_iso(),
        }, headers=H(token))
        assert r2.status_code == 200, r2.text

        d1 = session.get(f"{API}/dashboard", headers=H(token)).json()
        after = float(d1.get("unpaid_expense_balance", 0.0))
        assert round(after - before, 2) == 300.0, (
            f"Expected dashboard delta 300, got before={before} after={after}"
        )


class TestBulkPayments:
    """POST /api/payments/bulk scenarios."""

    def test_payments_bulk_equal_split_3_athletes(self, session, user):
        ids = [_create_athlete(session, user["token"], f"TEST_pe_{i}")["id"] for i in range(3)]
        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": ids,
            "amount": 300.0,
            "split_mode": "equal",
            "paid_on": _today_iso(),
            "method": "cash",
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 3
        assert all(p["amount"] == 100.0 for p in rows), rows
        assert sum(p["amount"] for p in rows) == 300.0
        assert sorted([p["athlete_id"] for p in rows]) == sorted(ids)

    def test_payments_bulk_same_split(self, session, user):
        ids = [_create_athlete(session, user["token"], f"TEST_ps_{i}")["id"] for i in range(3)]
        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": ids,
            "amount": 100.0,
            "split_mode": "same",
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 3
        assert all(p["amount"] == 100.0 for p in rows), rows

    def test_payments_bulk_single_athlete(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_psingle")
        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": [a["id"]],
            "amount": 200.0,
            "split_mode": "equal",
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 1
        assert rows[0]["amount"] == 200.0
        assert rows[0]["athlete_id"] == a["id"]

    def test_payments_bulk_empty_400(self, session, user):
        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": [], "amount": 100.0, "split_mode": "equal",
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 400

    def test_payments_bulk_zero_amount_400(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_pzero")
        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": [a["id"]], "amount": 0, "split_mode": "equal",
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 400

    def test_payments_bulk_cross_user_404(self, session, user, user2):
        other_a = _create_athlete(session, user2["token"], "TEST_other_pay_ath")
        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": [other_a["id"]],
            "amount": 50.0,
            "split_mode": "equal",
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 404, r.text
        assert other_a["id"] in str(r.json().get("detail", ""))


class TestSingleEndpointsRegression:
    """Sanity: single POST /api/expenses and POST /api/payments still work."""

    def test_single_expense_create(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_single_exp")
        r = session.post(f"{API}/expenses", json={
            "athlete_id": a["id"],
            "category": "Tuition",
            "amount": 75.0,
            "incurred_on": _today_iso(),
            "paid": False,
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["amount"] == 75.0
        assert body["athlete_id"] == a["id"]
        assert body["paid"] is False

    def test_single_payment_create(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_single_pay")
        r = session.post(f"{API}/payments", json={
            "athlete_id": a["id"],
            "amount": 50.0,
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["amount"] == 50.0
        assert body["athlete_id"] == a["id"]


class TestApplyPaymentLiteralStrictness:
    """ApplyPaymentRequest.source_type Literal['manual','fundraiser'] should reject 'card' with 422."""

    def test_invalid_source_type_card_422(self, session, user):
        a = _create_athlete(session, user["token"], "TEST_card_strict")
        # Create an expense first
        ec = session.post(f"{API}/expenses", json={
            "athlete_id": a["id"],
            "category": "Tuition",
            "amount": 100.0,
            "incurred_on": _today_iso(),
        }, headers=H(user["token"]))
        assert ec.status_code == 200, ec.text
        eid = ec.json()["id"]

        r = session.post(
            f"{API}/expenses/{eid}/apply-payment",
            json={"amount": 10, "source_type": "card"},
            headers=H(user["token"]),
        )
        assert r.status_code == 422, r.text
