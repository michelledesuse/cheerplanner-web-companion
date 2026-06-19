"""
Iteration 20 — verify dashboard tile aggregates now respect:
  A. paid=True expenses contribute to Paid YTD and remove themselves from Open Balance.
  B. Mixed partial payment + paid=True works correctly.
  C. Unapply round-trip (PATCH payment with applied_expense_ids=[] & allocations=[])
     correctly flips expense.paid back to False.
"""
import os
import uuid
import pytest
import requests
from pathlib import Path

# -------- BASE URL --------
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1]
                break
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"

EMAIL = "smoke@test.com"
PASSWORD = "password123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        s.post(f"{BASE_URL}/api/auth/signup",
               json={"email": EMAIL, "password": PASSWORD, "name": "Smoke"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---------- helpers ----------
def _new_athlete(client, name):
    r = client.post(f"{BASE_URL}/api/athletes", json={"name": name, "role": "athlete"})
    assert r.status_code == 200, r.text
    return r.json()


def _new_expense(client, athlete_id, amount, paid=False, category="Other", note=""):
    payload = {
        "athlete_id": athlete_id,
        "amount": amount,
        "category": category,
        "incurred_on": "2026-01-01",
        "due_date": "2026-06-01",
        "paid": paid,
        "note": note or f"TEST_iter20_{category}_{uuid.uuid4().hex[:6]}",
    }
    r = client.post(f"{BASE_URL}/api/expenses", json=payload)
    assert r.status_code == 200, r.text
    arr = r.json()
    return arr[0] if isinstance(arr, list) else arr


def _patch_expense(client, eid, **fields):
    r = client.patch(f"{BASE_URL}/api/expenses/{eid}", json=fields)
    assert r.status_code == 200, r.text
    return r.json()


def _post_payment(client, athlete_id, amount, paid_on="2026-02-01", allocations=None,
                  applied_expense_ids=None):
    payload = {"athlete_id": athlete_id, "amount": amount, "paid_on": paid_on}
    if allocations is not None:
        payload["allocations"] = allocations
    if applied_expense_ids is not None:
        payload["applied_expense_ids"] = applied_expense_ids
    r = client.post(f"{BASE_URL}/api/payments", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _patch_payment(client, pid, **fields):
    r = client.patch(f"{BASE_URL}/api/payments/{pid}", json=fields)
    assert r.status_code == 200, r.text
    return r.json()


def _get_expense(client, eid):
    r = client.get(f"{BASE_URL}/api/expenses")
    assert r.status_code == 200
    for e in r.json():
        if e["id"] == eid:
            return e
    return None


def _dashboard(client):
    r = client.get(f"{BASE_URL}/api/dashboard")
    assert r.status_code == 200, r.text
    return r.json()


def _cleanup(client, athlete_ids, expense_ids, payment_ids):
    for pid in payment_ids:
        client.delete(f"{BASE_URL}/api/payments/{pid}")
    if expense_ids:
        client.post(f"{BASE_URL}/api/bulk-delete",
                    json={"resource": "expenses", "ids": expense_ids})
    for aid in athlete_ids:
        client.delete(f"{BASE_URL}/api/athletes/{aid}")


# ======================================================================
# Scenario A — Dashboard tiles reflect paid=True expenses
# ======================================================================
class TestDashboardAlreadyPaid:
    @pytest.fixture(scope="class")
    def baseline(self, client):
        """Snapshot dashboard before any new data, so test asserts on deltas."""
        return _dashboard(client)

    @pytest.fixture(scope="class")
    def sandbox(self, client):
        ath = _new_athlete(client, f"TEST_iter20A_{uuid.uuid4().hex[:6]}")
        e1 = _new_expense(client, ath["id"], 100, paid=False, category="Tuition")
        e2 = _new_expense(client, ath["id"], 200, paid=True, category="Camp")
        ids = {"athlete": ath["id"], "e1": e1["id"], "e2": e2["id"]}
        yield ids
        _cleanup(client, [ids["athlete"]], [ids["e1"], ids["e2"]], [])

    def test_A1_paid_true_contributes_to_paid_ytd(self, client, baseline, sandbox):
        """e1 $100 paid=False, e2 $200 paid=True → ytd += $200, open += $100."""
        d = _dashboard(client)
        # paid_ytd grew by exactly $200 (the paid=True expense)
        ytd_delta = round(d["total_payments_ytd"] - baseline["total_payments_ytd"], 2)
        open_delta = round(
            d["unpaid_expense_balance"] - baseline["unpaid_expense_balance"], 2
        )
        assert ytd_delta == 200.0, (
            f"Paid YTD should grow by $200 from paid=True e2, got delta={ytd_delta}; "
            f"baseline={baseline['total_payments_ytd']} now={d['total_payments_ytd']}"
        )
        assert open_delta == 100.0, (
            f"Open Balance should grow by $100 (only e1), got delta={open_delta}; "
            f"baseline={baseline['unpaid_expense_balance']} now={d['unpaid_expense_balance']}"
        )

    def test_A2_toggle_e1_to_paid(self, client, baseline, sandbox):
        """Toggle e1 → paid=True → ytd +$300, open delta returns to 0."""
        _patch_expense(client, sandbox["e1"], paid=True)
        d = _dashboard(client)
        ytd_delta = round(d["total_payments_ytd"] - baseline["total_payments_ytd"], 2)
        open_delta = round(
            d["unpaid_expense_balance"] - baseline["unpaid_expense_balance"], 2
        )
        assert ytd_delta == 300.0, (
            f"After toggle, Paid YTD delta should be $300; got {ytd_delta}"
        )
        assert open_delta == 0.0, (
            f"After toggle, Open Balance delta should be $0; got {open_delta}"
        )

    def test_A3_toggle_e1_back_to_unpaid(self, client, baseline, sandbox):
        """Toggle e1 back → paid=False → reverts to state of test_A1."""
        _patch_expense(client, sandbox["e1"], paid=False)
        d = _dashboard(client)
        ytd_delta = round(d["total_payments_ytd"] - baseline["total_payments_ytd"], 2)
        open_delta = round(
            d["unpaid_expense_balance"] - baseline["unpaid_expense_balance"], 2
        )
        assert ytd_delta == 200.0, f"Revert: Paid YTD delta should be $200; got {ytd_delta}"
        assert open_delta == 100.0, f"Revert: Open delta should be $100; got {open_delta}"


# ======================================================================
# Scenario B — Mixed: partial payment + already paid
# ======================================================================
class TestDashboardMixed:
    @pytest.fixture(scope="class")
    def baseline(self, client):
        return _dashboard(client)

    @pytest.fixture(scope="class")
    def sandbox(self, client):
        ath = _new_athlete(client, f"TEST_iter20B_{uuid.uuid4().hex[:6]}")
        e1 = _new_expense(client, ath["id"], 100, paid=False, category="Tuition")
        e2 = _new_expense(client, ath["id"], 200, paid=False, category="Gear")
        ids = {"athlete": ath["id"], "e1": e1["id"], "e2": e2["id"], "payments": []}
        yield ids
        _cleanup(client, [ids["athlete"]], [ids["e1"], ids["e2"]], ids["payments"])

    def test_B1_partial_payment_60_to_e1(self, client, baseline, sandbox):
        """POST $60 covering e1 (waterfall) → ytd +$60, open +$240."""
        pay = _post_payment(
            client, sandbox["athlete"], 60, paid_on="2026-02-01",
            applied_expense_ids=[sandbox["e1"]],
        )
        sandbox["payments"].append(pay["id"])

        d = _dashboard(client)
        ytd_delta = round(d["total_payments_ytd"] - baseline["total_payments_ytd"], 2)
        open_delta = round(
            d["unpaid_expense_balance"] - baseline["unpaid_expense_balance"], 2
        )
        assert ytd_delta == 60.0, f"Paid YTD delta should be $60, got {ytd_delta}"
        assert open_delta == 240.0, (
            f"Open delta should be $40 (e1) + $200 (e2) = $240; got {open_delta}"
        )

    def test_B2_toggle_e2_to_paid(self, client, baseline, sandbox):
        """PATCH e2 → paid=True → ytd +$260, open +$40."""
        _patch_expense(client, sandbox["e2"], paid=True)
        d = _dashboard(client)
        ytd_delta = round(d["total_payments_ytd"] - baseline["total_payments_ytd"], 2)
        open_delta = round(
            d["unpaid_expense_balance"] - baseline["unpaid_expense_balance"], 2
        )
        assert ytd_delta == 260.0, (
            f"Paid YTD delta should be $60 (partial) + $200 (paid=True) = $260; got {ytd_delta}"
        )
        assert open_delta == 40.0, (
            f"Open delta should be $40 (remaining on e1); got {open_delta}"
        )


# ======================================================================
# Scenario C — Unapply round-trip (regression of iter 19)
# ======================================================================
class TestUnapplyRoundTrip:
    @pytest.fixture(scope="class")
    def sandbox(self, client):
        ath = _new_athlete(client, f"TEST_iter20C_{uuid.uuid4().hex[:6]}")
        e1 = _new_expense(client, ath["id"], 100, paid=False, category="Tuition")
        ids = {"athlete": ath["id"], "e1": e1["id"], "payments": []}
        yield ids
        _cleanup(client, [ids["athlete"]], [ids["e1"]], ids["payments"])

    def test_C1_payment_marks_expense_paid(self, client, sandbox):
        """POST $100 covering e1 $100 → e1 paid=True, balance=0."""
        pay = _post_payment(
            client, sandbox["athlete"], 100, paid_on="2026-02-01",
            applied_expense_ids=[sandbox["e1"]],
        )
        sandbox["payments"].append(pay["id"])

        e1 = _get_expense(client, sandbox["e1"])
        assert e1 is not None
        assert e1.get("paid") is True, f"e1.paid should be True; got {e1.get('paid')}"
        bd = float(e1.get("balance_due") or 0)
        assert bd == 0.0, f"e1.balance_due should be 0; got {bd}"

    def test_C2_unapply_clears_expense_paid(self, client, sandbox):
        """PATCH payment with applied_expense_ids=[] & allocations=[] → e1 paid=False, balance=$100."""
        pid = sandbox["payments"][0]
        updated = _patch_payment(
            client, pid, applied_expense_ids=[], allocations=[]
        )
        # confirm the payment row no longer references any expense
        assert (updated.get("applied_expense_ids") or []) == []
        assert (updated.get("allocations") or []) == []

        e1 = _get_expense(client, sandbox["e1"])
        assert e1 is not None
        assert e1.get("paid") is False, (
            f"After unapply, e1.paid should be False; got {e1.get('paid')}"
        )
        bd = float(e1.get("balance_due") or 0)
        assert bd == 100.0, f"After unapply, e1.balance_due should be $100; got {bd}"
