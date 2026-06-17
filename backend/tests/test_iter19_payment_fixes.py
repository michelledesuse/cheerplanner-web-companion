"""
Iteration 19 — verify fixes for HIGH bugs from iteration_18:
  A. POST /api/payments honors explicit `allocations` (PaymentCreate now has the field).
  B. PATCH /api/payments amount DECREASE clears previously-covered expenses' paid flags.
  C. PATCH /api/payments with explicit `allocations` override skips the waterfall.
  D. DELETE /api/payments refreshes expense.paid flags.
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


# helpers
def _new_athlete(client, name):
    r = client.post(f"{BASE_URL}/api/athletes",
                    json={"name": name, "role": "athlete"})
    assert r.status_code == 200, r.text
    return r.json()


def _new_expense(client, athlete_id, amount, due_date, category="Other"):
    payload = {
        "athlete_id": athlete_id,
        "amount": amount,
        "category": category,
        "incurred_on": "2026-01-01",
        "due_date": due_date,
        "note": f"TEST_iter19_{category}_{due_date}",
    }
    r = client.post(f"{BASE_URL}/api/expenses", json=payload)
    assert r.status_code == 200, r.text
    arr = r.json()
    return arr[0] if isinstance(arr, list) else arr


def _get_expense(client, eid):
    r = client.get(f"{BASE_URL}/api/expenses")
    assert r.status_code == 200
    for e in r.json():
        if e["id"] == eid:
            return e
    return None


def _get_payment(client, pid):
    r = client.get(f"{BASE_URL}/api/payments")
    assert r.status_code == 200
    for p in r.json():
        if p["id"] == pid:
            return p
    return None


# ======================================================================
# Scenario A — POST with explicit allocations honored
# ======================================================================
class TestPostExplicitAllocations:
    @pytest.fixture(scope="class")
    def sandbox(self, client):
        ath = _new_athlete(client, f"TEST_iter19A_{uuid.uuid4().hex[:6]}")
        e1 = _new_expense(client, ath["id"], 100, "2026-04-01", "Tuition")
        e2 = _new_expense(client, ath["id"], 100, "2026-05-01", "Gear")
        ids = {"athlete": ath["id"], "e1": e1["id"], "e2": e2["id"], "payments": []}
        yield ids
        for pid in ids["payments"]:
            client.delete(f"{BASE_URL}/api/payments/{pid}")
        client.post(f"{BASE_URL}/api/bulk-delete",
                    json={"resource": "expenses", "ids": [ids["e1"], ids["e2"]]})
        client.delete(f"{BASE_URL}/api/athletes/{ids['athlete']}")

    def test_A_post_with_explicit_allocations(self, client, sandbox):
        """POST {amount:100, allocations:[80,20]} → allocations preserved as 80/20, no waterfall."""
        payload = {
            "athlete_id": sandbox["athlete"],
            "amount": 100,
            "paid_on": "2026-02-01",
            "allocations": [
                {"expense_id": sandbox["e1"], "amount": 80},
                {"expense_id": sandbox["e2"], "amount": 20},
            ],
        }
        r = client.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 200, r.text
        pay = r.json()
        sandbox["payments"].append(pay["id"])

        allocs = {a["expense_id"]: a["amount"] for a in (pay.get("allocations") or [])}
        assert allocs.get(sandbox["e1"]) == 80.0, f"Expected E1=80, got {allocs}"
        assert allocs.get(sandbox["e2"]) == 20.0, f"Expected E2=20, got {allocs}"

        # GET back the payment to make sure it persisted
        fetched = _get_payment(client, pay["id"])
        assert fetched is not None
        got = {a["expense_id"]: a["amount"] for a in (fetched.get("allocations") or [])}
        assert got.get(sandbox["e1"]) == 80.0
        assert got.get(sandbox["e2"]) == 20.0

        # Expenses: E1 balance=20, E2 balance=80, neither paid
        e1 = _get_expense(client, sandbox["e1"])
        e2 = _get_expense(client, sandbox["e2"])
        assert e1["balance_due"] == 20.0, f"E1 balance_due expected 20, got {e1['balance_due']}"
        assert e2["balance_due"] == 80.0, f"E2 balance_due expected 80, got {e2['balance_due']}"
        assert e1["paid"] is False
        assert e2["paid"] is False


# ======================================================================
# Scenario B — PATCH amount decrease clears stale paid flags
# ======================================================================
class TestPatchAmountDecreaseClearsFlags:
    @pytest.fixture(scope="class")
    def sandbox(self, client):
        ath = _new_athlete(client, f"TEST_iter19B_{uuid.uuid4().hex[:6]}")
        # Tuition $100 due 3/1, Gear $200 due 2/1 — Gear earlier
        tuition = _new_expense(client, ath["id"], 100, "2026-03-01", "Tuition")
        gear = _new_expense(client, ath["id"], 200, "2026-02-01", "Gear")
        ids = {"athlete": ath["id"], "tuition": tuition["id"],
               "gear": gear["id"], "payments": []}
        yield ids
        for pid in ids["payments"]:
            client.delete(f"{BASE_URL}/api/payments/{pid}")
        client.post(f"{BASE_URL}/api/bulk-delete",
                    json={"resource": "expenses",
                          "ids": [ids["tuition"], ids["gear"]]})
        client.delete(f"{BASE_URL}/api/athletes/{ids['athlete']}")

    def test_B_patch_amount_decrease_resets_both_flags(self, client, sandbox):
        # POST payment $300 covering both
        payload = {
            "athlete_id": sandbox["athlete"],
            "amount": 300,
            "paid_on": "2026-01-15",
            "applied_expense_ids": [sandbox["tuition"], sandbox["gear"]],
        }
        r = client.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 200, r.text
        pay = r.json()
        sandbox["payments"].append(pay["id"])

        # Verify both paid
        tuition = _get_expense(client, sandbox["tuition"])
        gear = _get_expense(client, sandbox["gear"])
        assert tuition["paid"] is True and gear["paid"] is True

        # PATCH amount=60 → waterfall only covers Gear ($60), Tuition drops out
        r2 = client.patch(f"{BASE_URL}/api/payments/{pay['id']}",
                          json={"amount": 60})
        assert r2.status_code == 200, r2.text
        pay2 = r2.json()
        allocs = {a["expense_id"]: a["amount"] for a in (pay2.get("allocations") or [])}
        assert allocs.get(sandbox["gear"]) == 60.0, f"Gear should get $60, got {allocs}"
        # Tuition either absent or 0
        assert sandbox["tuition"] not in allocs or allocs.get(sandbox["tuition"], 0) == 0

        # CRITICAL: stale paid flags cleared on BOTH expenses
        tuition2 = _get_expense(client, sandbox["tuition"])
        gear2 = _get_expense(client, sandbox["gear"])
        assert gear2["paid"] is False, "Gear paid should clear (balance $140)"
        assert tuition2["paid"] is False, \
            "Tuition paid should clear — was the iter18 HIGH bug!"
        assert gear2["balance_due"] == 140.0
        assert tuition2["balance_due"] == 100.0


# ======================================================================
# Scenario C — PATCH with explicit allocations override
# ======================================================================
class TestPatchExplicitAllocationsOverride:
    @pytest.fixture(scope="class")
    def sandbox(self, client):
        ath = _new_athlete(client, f"TEST_iter19C_{uuid.uuid4().hex[:6]}")
        tuition = _new_expense(client, ath["id"], 100, "2026-03-01", "Tuition")
        gear = _new_expense(client, ath["id"], 200, "2026-02-01", "Gear")
        ids = {"athlete": ath["id"], "tuition": tuition["id"],
               "gear": gear["id"], "payments": []}
        yield ids
        for pid in ids["payments"]:
            client.delete(f"{BASE_URL}/api/payments/{pid}")
        client.post(f"{BASE_URL}/api/bulk-delete",
                    json={"resource": "expenses",
                          "ids": [ids["tuition"], ids["gear"]]})
        client.delete(f"{BASE_URL}/api/athletes/{ids['athlete']}")

    def test_C_patch_explicit_allocations_skip_waterfall(self, client, sandbox):
        # POST initial $300 covering both (waterfall)
        payload = {
            "athlete_id": sandbox["athlete"],
            "amount": 300,
            "paid_on": "2026-01-15",
            "applied_expense_ids": [sandbox["tuition"], sandbox["gear"]],
        }
        r = client.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 200, r.text
        pay = r.json()
        sandbox["payments"].append(pay["id"])

        # PATCH with explicit allocations 50/50 (override)
        patch_body = {
            "amount": 100,
            "allocations": [
                {"expense_id": sandbox["tuition"], "amount": 50},
                {"expense_id": sandbox["gear"], "amount": 50},
            ],
        }
        r2 = client.patch(f"{BASE_URL}/api/payments/{pay['id']}", json=patch_body)
        assert r2.status_code == 200, r2.text
        pay2 = r2.json()
        allocs = {a["expense_id"]: a["amount"] for a in (pay2.get("allocations") or [])}
        assert allocs.get(sandbox["tuition"]) == 50.0, \
            f"Explicit 50/50 override should win, got {allocs}"
        assert allocs.get(sandbox["gear"]) == 50.0, \
            f"Explicit 50/50 override should win, got {allocs}"

        # GET back
        fetched = _get_payment(client, pay["id"])
        got = {a["expense_id"]: a["amount"] for a in (fetched.get("allocations") or [])}
        assert got.get(sandbox["tuition"]) == 50.0
        assert got.get(sandbox["gear"]) == 50.0

        # Expenses: balances reflect 50/50
        tuition = _get_expense(client, sandbox["tuition"])
        gear = _get_expense(client, sandbox["gear"])
        assert tuition["balance_due"] == 50.0
        assert gear["balance_due"] == 150.0
        assert tuition["paid"] is False
        assert gear["paid"] is False


# ======================================================================
# Scenario D — DELETE refreshes paid flags
# ======================================================================
class TestDeleteRefreshesPaidFlags:
    @pytest.fixture(scope="class")
    def sandbox(self, client):
        ath = _new_athlete(client, f"TEST_iter19D_{uuid.uuid4().hex[:6]}")
        camp = _new_expense(client, ath["id"], 50, "2026-01-20", "Camp")
        ids = {"athlete": ath["id"], "camp": camp["id"]}
        yield ids
        client.post(f"{BASE_URL}/api/bulk-delete",
                    json={"resource": "expenses", "ids": [ids["camp"]]})
        client.delete(f"{BASE_URL}/api/athletes/{ids['athlete']}")

    def test_D_delete_payment_clears_paid_flag(self, client, sandbox):
        # Fully cover camp ($50)
        r = client.post(f"{BASE_URL}/api/payments", json={
            "athlete_id": sandbox["athlete"],
            "amount": 50,
            "paid_on": "2026-01-15",
            "applied_expense_ids": [sandbox["camp"]],
        })
        assert r.status_code == 200, r.text
        pay = r.json()
        camp_before = _get_expense(client, sandbox["camp"])
        assert camp_before["paid"] is True, "Camp should be paid before delete"
        assert camp_before["balance_due"] == 0.0

        # DELETE payment
        rd = client.delete(f"{BASE_URL}/api/payments/{pay['id']}")
        assert rd.status_code in (200, 204), rd.text

        # Camp should now be unpaid with balance full
        camp_after = _get_expense(client, sandbox["camp"])
        assert camp_after["paid"] is False, \
            "Camp paid flag should clear after payment delete (iter18 minor bug)"
        assert camp_after["balance_due"] == 50.0, \
            f"Camp balance should restore to $50, got {camp_after['balance_due']}"
