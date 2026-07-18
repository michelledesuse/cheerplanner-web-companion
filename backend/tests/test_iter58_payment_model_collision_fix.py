"""
Regression tests for iter58 fix: PaymentEntry class-name collision in core/models.py.

Bug: Team Hub payment-tracking model was named PaymentEntry and shadowed the
money PaymentEntry. GET /api/payments raised HTTP 500 (pydantic 'member_id
required'). Money hub Promise.all failed so expenses+payments+fundraisers
appeared blank.

Fix: Team Hub model renamed to TeamPaymentEntry. Money PaymentEntry restored.

These tests cover:
  1. GET /api/payments returns 200 (primary regression)
  2. GET /api/expenses and /api/fundraisers return 200
  3. POST /api/payments allocates to expenses (waterfall) and expense.paid flag
     reflects the applied payment
  4. Expenses import (long + wide form) attaches correct category
  5. Team Hub payment tracker CRUD + set member paid still works after rename
  6. GET /api/dashboard still returns aggregate totals
"""
import io
import os
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

# EXPO_BACKEND_URL is not exported in the shell; read EXPO_PUBLIC_BACKEND_URL
# from frontend/.env (see agent_to_agent_context_note).
_env = dotenv_values(Path("/app/frontend/.env"))
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or _env.get("EXPO_PUBLIC_BACKEND_URL")
            or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


@pytest.fixture(scope="session")
def athlete_id(client):
    r = client.get(f"{BASE_URL}/api/athletes", timeout=15)
    assert r.status_code == 200
    athletes = r.json()
    assert len(athletes) > 0, "seeded account should have >=1 athlete"
    return athletes[0]["id"]


# ---------- 1. GET /api/payments regression ----------
class TestPaymentsListRegression:
    def test_get_payments_returns_200_not_500(self, client):
        """Primary regression: previously raised 500 due to model collision."""
        r = client.get(f"{BASE_URL}/api/payments", timeout=15)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert isinstance(data, list)
        # Validate PaymentEntry (money) shape — NOT TeamPaymentEntry shape
        if data:
            p = data[0]
            assert "athlete_id" in p, "money PaymentEntry must have athlete_id"
            assert "amount" in p and "paid_on" in p
            assert "member_id" not in p, "must NOT be Team Hub PaymentEntry shape"

    def test_get_expenses_ok(self, client):
        r = client.get(f"{BASE_URL}/api/expenses", timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), list)

    def test_get_fundraisers_ok(self, client):
        r = client.get(f"{BASE_URL}/api/fundraisers", timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), list)

    def test_get_athletes_ok(self, client):
        r = client.get(f"{BASE_URL}/api/athletes", timeout=15)
        assert r.status_code == 200


# ---------- 2. Dashboard regression ----------
class TestDashboardRegression:
    def test_dashboard_shows_expense_payment_totals(self, client):
        r = client.get(f"{BASE_URL}/api/dashboard", timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ("total_expenses_ytd", "total_payments_ytd", "outstanding_balance"):
            assert k in d, f"dashboard missing {k}"
            assert isinstance(d[k], (int, float))


# ---------- 3. Payment application flow ----------
class TestPaymentApplication:
    def test_create_payment_applies_to_expense_and_marks_paid(self, client, athlete_id):
        # Create a fresh expense so we can verify payment application deterministically
        exp_payload = {
            "athlete_id": athlete_id,
            "category": "TEST_PayApply",
            "amount": 100.0,
            "incurred_on": "2026-01-10",
        }
        r = client.post(f"{BASE_URL}/api/expenses", json=exp_payload, timeout=15)
        assert r.status_code == 200, r.text[:300]
        exp_list = r.json()
        assert isinstance(exp_list, list) and len(exp_list) == 1
        exp = exp_list[0]
        exp_id = exp["id"]
        assert exp.get("paid") in (False, None)

        try:
            # Create a payment applied to that expense (full)
            pay_payload = {
                "athlete_id": athlete_id,
                "amount": 100.0,
                "paid_on": "2026-01-11",
                "method": "card",
                "note": "TEST_PayApply",
                "applied_expense_ids": [exp_id],
            }
            r = client.post(f"{BASE_URL}/api/payments", json=pay_payload, timeout=15)
            assert r.status_code == 200, r.text[:300]
            pay = r.json()
            pay_id = pay["id"]
            # Waterfall should populate allocations to that expense
            allocs = pay.get("allocations") or []
            assert any(a.get("expense_id") == exp_id for a in allocs), \
                f"payment allocations missing target expense: {allocs}"
            assert allocs[0]["amount"] == pytest.approx(100.0)

            try:
                # Verify GET /api/payments contains this payment
                r = client.get(f"{BASE_URL}/api/payments", timeout=15)
                assert r.status_code == 200
                ids = {p["id"] for p in r.json()}
                assert pay_id in ids

                # Verify expense is now marked paid
                r = client.get(f"{BASE_URL}/api/expenses", timeout=15)
                assert r.status_code == 200
                exp_after = next(e for e in r.json() if e["id"] == exp_id)
                assert exp_after.get("paid") is True, \
                    f"expense not marked paid after full payment: {exp_after}"
            finally:
                client.delete(f"{BASE_URL}/api/payments/{pay_id}", timeout=15)
        finally:
            client.delete(f"{BASE_URL}/api/expenses/{exp_id}", timeout=15)

    def test_partial_payment_leaves_expense_unpaid(self, client, athlete_id):
        r = client.post(f"{BASE_URL}/api/expenses", json={
            "athlete_id": athlete_id, "category": "TEST_Partial",
            "amount": 100.0, "incurred_on": "2026-01-10",
        }, timeout=15)
        assert r.status_code == 200
        exp_id = r.json()[0]["id"]
        try:
            r = client.post(f"{BASE_URL}/api/payments", json={
                "athlete_id": athlete_id, "amount": 40.0,
                "paid_on": "2026-01-11", "applied_expense_ids": [exp_id],
            }, timeout=15)
            assert r.status_code == 200
            pay_id = r.json()["id"]
            try:
                r = client.get(f"{BASE_URL}/api/expenses", timeout=15)
                exp_after = next(e for e in r.json() if e["id"] == exp_id)
                assert exp_after.get("paid") in (False, None), \
                    "partial payment should NOT mark expense paid"
            finally:
                client.delete(f"{BASE_URL}/api/payments/{pay_id}", timeout=15)
        finally:
            client.delete(f"{BASE_URL}/api/expenses/{exp_id}", timeout=15)


# ---------- 4. Expenses import (category attachment) ----------
class TestExpensesImport:
    def _preview_and_commit(self, token, csv_bytes, filename="test.csv"):
        # Preview (multipart)
        r = requests.post(
            f"{BASE_URL}/api/import/preview",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": (filename, csv_bytes, "text/csv")},
            data={"kind": "expenses"},
            timeout=20,
        )
        assert r.status_code == 200, f"preview failed: {r.status_code} {r.text[:300]}"
        return r.json()

    def test_long_form_import_attaches_category(self, client, token, athlete_id):
        # Get athlete name for long form
        r = client.get(f"{BASE_URL}/api/athletes", timeout=15)
        athlete = next(a for a in r.json() if a["id"] == athlete_id)
        aname = athlete["name"]

        csv = (
            "athlete,category,amount,date,note\n"
            f"{aname},TEST_LongCat,55.00,2026-01-12,imp_long_note\n"
        ).encode("utf-8")

        preview = self._preview_and_commit(token, csv, "long.csv")
        assert preview["kind"] == "expenses"
        assert preview["format"] == "long"
        rows = preview["rows"]
        assert len(rows) == 1
        assert rows[0]["category"] == "TEST_LongCat"

        # Commit
        r = client.post(
            f"{BASE_URL}/api/import/commit",
            json={"kind": "expenses", "rows": rows, "athlete_map": {}},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        result = r.json()
        assert result["created"] >= 1

        # Verify the expense appears with correct category
        r = client.get(f"{BASE_URL}/api/expenses", timeout=15)
        assert r.status_code == 200
        imported = [e for e in r.json() if e.get("category") == "TEST_LongCat"
                    and e.get("note") == "imp_long_note"]
        assert imported, "imported long-form expense not found with correct category"
        try:
            assert imported[0]["athlete_id"] == athlete_id
            assert imported[0]["amount"] == pytest.approx(55.0)
        finally:
            for e in imported:
                client.delete(f"{BASE_URL}/api/expenses/{e['id']}", timeout=10)

    def test_wide_form_import_attaches_category(self, client, token, athlete_id):
        r = client.get(f"{BASE_URL}/api/athletes", timeout=15)
        athlete = next(a for a in r.json() if a["id"] == athlete_id)
        aname = athlete["name"]

        # Wide form: date,category,<athlete_col_1>,<athlete_col_2>...
        csv = (
            f"date,category,{aname}\n"
            f"2026-01-12,TEST_WideCat,77.50\n"
        ).encode("utf-8")

        preview = self._preview_and_commit(client.headers["Authorization"].split()[1], csv, "wide.csv")
        assert preview["format"] == "wide", f"format was {preview.get('format')}"
        rows = preview["rows"]
        assert len(rows) == 1
        assert rows[0]["category"] == "TEST_WideCat"
        assert aname in rows[0].get("amounts", {})

        # Map the athlete column
        athlete_map = {aname: athlete_id}
        r = client.post(
            f"{BASE_URL}/api/import/commit",
            json={"kind": "expenses", "rows": rows, "athlete_map": athlete_map},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        assert r.json()["created"] >= 1

        # Verify
        r = client.get(f"{BASE_URL}/api/expenses", timeout=15)
        imported = [e for e in r.json() if e.get("category") == "TEST_WideCat"]
        assert imported, "imported wide-form expense not found with correct category"
        try:
            assert imported[0]["athlete_id"] == athlete_id
            assert imported[0]["amount"] == pytest.approx(77.5)
        finally:
            for e in imported:
                client.delete(f"{BASE_URL}/api/expenses/{e['id']}", timeout=10)


# ---------- 5. Team Hub payment tracker (post-rename) ----------
class TestTeamHubPaymentsRename:
    def test_team_payments_list_ok(self, client):
        """After rename to TeamPaymentEntry, list endpoint must still work."""
        r = client.get(f"{BASE_URL}/api/team/payments", timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), list)

    def test_team_payment_tracker_full_flow(self, client):
        # Create tracker
        r = client.post(f"{BASE_URL}/api/team/payments", json={
            "name": "TEST_TrackerRename",
            "amount": 50.0,
            "note": "regression",
        }, timeout=15)
        assert r.status_code == 200, r.text[:300]
        tracker = r.json()
        tid = tracker["id"]
        assert tracker["name"] == "TEST_TrackerRename"
        assert tracker.get("entries") == []

        try:
            # GET single
            r = client.get(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)
            assert r.status_code == 200
            assert "summary" in r.json()
            summary = r.json()["summary"]
            assert set(summary.keys()) >= {"paid_count", "member_total", "collected"}

            # Find a roster member (not parent)
            r = client.get(f"{BASE_URL}/api/roster", timeout=15)
            assert r.status_code == 200
            roster = [m for m in r.json() if m.get("role") != "parent"]
            if not roster:
                pytest.skip("no non-parent roster member available")
            member_id = roster[0]["id"]

            # PUT set member paid
            r = client.put(
                f"{BASE_URL}/api/team/payments/{tid}/member/{member_id}",
                json={"paid": True, "amount_paid": 50.0, "method": "cash"},
                timeout=15,
            )
            assert r.status_code == 200, r.text[:300]
            updated = r.json()
            entries = updated.get("entries", [])
            assert any(e.get("member_id") == member_id and e.get("paid") for e in entries), \
                f"paid entry not persisted: {entries}"
            # TeamPaymentEntry uses member_id (NOT athlete_id) — sanity check shape
            for e in entries:
                assert "member_id" in e
                assert "athlete_id" not in e
            assert updated["summary"]["paid_count"] == 1
            assert updated["summary"]["collected"] == pytest.approx(50.0)

            # Unpay
            r = client.put(
                f"{BASE_URL}/api/team/payments/{tid}/member/{member_id}",
                json={"paid": False},
                timeout=15,
            )
            assert r.status_code == 200
            assert r.json()["summary"]["paid_count"] == 0
        finally:
            r = client.delete(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)
            assert r.status_code == 200
