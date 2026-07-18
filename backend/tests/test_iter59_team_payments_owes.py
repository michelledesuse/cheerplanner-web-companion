"""
Iter59 backend tests — Team Payment Tracking owes/short summary.

Covers:
  1. GET /api/team/payments and GET /api/team/payments/{id} include the new
     summary fields: outstanding, short_count, unpaid_count, expected_total,
     expected_per_person (plus existing paid_count, member_total, collected).
  2. Owes math with an expected amount (e.g. 50):
        - member paid full (50) -> not short
        - member paid partial (20) -> short with 30 outstanding
        - unrecorded members -> each adds full 50 to outstanding and short_count
  3. Owes without expected amount (amount null):
        - outstanding == None
        - short_count == unpaid_count
  4. PUT /api/team/payments/{id}/member/{member_id} recomputes short_count and
     outstanding correctly after marking someone paid.
  5. Regression: GET /api/payments (money hub) still returns 200.
  6. Regression: Team Hub payment recording (amount/method/date) still works.
"""
import os
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values(Path("/app/frontend/.env"))
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or _env.get("EXPO_PUBLIC_BACKEND_URL")
            or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="session")
def roster_ids(client):
    """Ensure >=3 non-parent roster members. Seed TEST_ athletes if needed and
    clean them up at end of session."""
    r = client.get(f"{BASE_URL}/api/roster", timeout=15)
    assert r.status_code == 200, r.text
    members = [m for m in r.json() if m.get("role") != "parent"]
    seeded = []
    while len(members) + len(seeded) < 3:
        idx = len(seeded) + 1
        cr = client.post(
            f"{BASE_URL}/api/roster",
            json={"name": f"TEST_iter59_athlete_{idx}", "role": "athlete"},
            timeout=15,
        )
        assert cr.status_code == 200, cr.text
        seeded.append(cr.json()["id"])
    all_ids = [m["id"] for m in members] + seeded
    yield all_ids
    # cleanup seeded members
    for mid in seeded:
        client.delete(f"{BASE_URL}/api/roster/{mid}", timeout=15)


@pytest.fixture()
def tracker_with_amount(client):
    """Create a fresh tracker with expected=50, tear down after."""
    r = client.post(f"{BASE_URL}/api/team/payments",
                    json={"name": "TEST_iter59_owes_50", "amount": 50}, timeout=15)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    yield tid
    client.delete(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)


@pytest.fixture()
def tracker_no_amount(client):
    r = client.post(f"{BASE_URL}/api/team/payments",
                    json={"name": "TEST_iter59_owes_null", "amount": None}, timeout=15)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    yield tid
    client.delete(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)


# ---------- 1. Summary shape ----------
class TestSummaryShape:
    def test_list_summary_has_new_fields(self, client, tracker_with_amount):
        r = client.get(f"{BASE_URL}/api/team/payments", timeout=15)
        assert r.status_code == 200, r.text
        arr = r.json()
        found = next((t for t in arr if t["id"] == tracker_with_amount), None)
        assert found is not None
        s = found["summary"]
        for key in ("paid_count", "member_total", "collected", "outstanding",
                    "short_count", "unpaid_count", "expected_total",
                    "expected_per_person"):
            assert key in s, f"missing key {key} in summary: {s}"

    def test_detail_summary_has_new_fields(self, client, tracker_with_amount):
        r = client.get(f"{BASE_URL}/api/team/payments/{tracker_with_amount}", timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        for key in ("paid_count", "member_total", "collected", "outstanding",
                    "short_count", "unpaid_count", "expected_total",
                    "expected_per_person"):
            assert key in s


# ---------- 2. Owes math WITH expected amount ----------
class TestOwesWithExpectedAmount:
    def test_full_partial_and_unrecorded(self, client, tracker_with_amount, roster_ids):
        tid = tracker_with_amount
        total_roster = len(roster_ids)
        # Baseline: nobody has paid — all short, outstanding = 50*total
        r = client.get(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)
        s = r.json()["summary"]
        assert s["expected_per_person"] == 50
        assert s["expected_total"] == 50 * total_roster
        assert s["member_total"] == total_roster
        assert s["paid_count"] == 0
        assert s["unpaid_count"] == total_roster
        assert s["short_count"] == total_roster
        assert s["outstanding"] == 50 * total_roster
        assert s["collected"] == 0

        # (a) member[0] pays FULL 50 -> not short
        m0 = roster_ids[0]
        r = client.put(f"{BASE_URL}/api/team/payments/{tid}/member/{m0}",
                       json={"paid": True, "amount_paid": 50, "method": "Cash"},
                       timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        assert s["paid_count"] == 1
        assert s["collected"] == 50
        assert s["short_count"] == total_roster - 1, s
        # outstanding = 50 * (total_roster - 1) (m0 fully paid, entry shortfall 0)
        assert s["outstanding"] == 50 * (total_roster - 1), s

        # (b) member[1] pays PARTIAL 20 -> short with 30 outstanding for that entry
        m1 = roster_ids[1]
        r = client.put(f"{BASE_URL}/api/team/payments/{tid}/member/{m1}",
                       json={"paid": True, "amount_paid": 20, "method": "Cash"},
                       timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        # collected now 50+20
        assert s["collected"] == 70, s
        assert s["paid_count"] == 2
        # short_count = total_roster - 1 (covered m0 only)  -> m1 partial still counts as short
        assert s["short_count"] == total_roster - 1, s
        # outstanding = 30 (m1 short) + 50 * (total_roster - 2 unrecorded)
        expected_out = 30 + 50 * (total_roster - 2)
        assert s["outstanding"] == expected_out, s
        assert s["unpaid_count"] == total_roster - 2

    def test_short_count_never_negative(self, client, tracker_with_amount, roster_ids):
        """Overpaying still counts as covered, never negative short_count."""
        m0 = roster_ids[0]
        r = client.put(f"{BASE_URL}/api/team/payments/{tracker_with_amount}/member/{m0}",
                       json={"paid": True, "amount_paid": 200}, timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        assert s["short_count"] == len(roster_ids) - 1
        assert s["outstanding"] == 50 * (len(roster_ids) - 1)


# ---------- 3. Owes math WITHOUT expected amount ----------
class TestOwesWithoutExpected:
    def test_null_expected(self, client, tracker_no_amount, roster_ids):
        r = client.get(f"{BASE_URL}/api/team/payments/{tracker_no_amount}", timeout=15)
        s = r.json()["summary"]
        assert s["expected_per_person"] is None
        assert s["expected_total"] is None
        assert s["outstanding"] is None
        # short_count == unpaid_count
        assert s["short_count"] == s["unpaid_count"] == len(roster_ids)

    def test_null_expected_after_paying_one(self, client, tracker_no_amount, roster_ids):
        m0 = roster_ids[0]
        r = client.put(f"{BASE_URL}/api/team/payments/{tracker_no_amount}/member/{m0}",
                       json={"paid": True, "amount_paid": 15}, timeout=15)
        assert r.status_code == 200
        s = r.json()["summary"]
        assert s["outstanding"] is None
        assert s["unpaid_count"] == len(roster_ids) - 1
        assert s["short_count"] == s["unpaid_count"]


# ---------- 4. PUT recompute ----------
class TestPutRecompute:
    def test_marking_paid_reduces_short_and_outstanding(self, client, tracker_with_amount, roster_ids):
        tid = tracker_with_amount
        # baseline snapshot
        r = client.get(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)
        base = r.json()["summary"]

        m0 = roster_ids[0]
        r = client.put(f"{BASE_URL}/api/team/payments/{tid}/member/{m0}",
                       json={"paid": True, "amount_paid": 50}, timeout=15)
        after = r.json()["summary"]
        assert after["short_count"] == base["short_count"] - 1
        assert after["outstanding"] == base["outstanding"] - 50

        # Now flip back to unpaid
        r = client.put(f"{BASE_URL}/api/team/payments/{tid}/member/{m0}",
                       json={"paid": False}, timeout=15)
        rev = r.json()["summary"]
        assert rev["short_count"] == base["short_count"]
        assert rev["outstanding"] == base["outstanding"]


# ---------- 5. Regression: money hub /api/payments ----------
class TestMoneyRegression:
    def test_money_payments_200(self, client):
        r = client.get(f"{BASE_URL}/api/payments", timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


# ---------- 6. Regression: full record round-trip ----------
class TestTeamRecordRegression:
    def test_full_record_persists_and_returns_in_detail(self, client, tracker_with_amount, roster_ids):
        tid = tracker_with_amount
        m0 = roster_ids[0]
        r = client.put(f"{BASE_URL}/api/team/payments/{tid}/member/{m0}",
                       json={
                           "paid": True,
                           "amount_paid": 40,
                           "method": "Venmo",
                           "paid_at": "2026-01-15T00:00:00Z",
                           "note": "partial",
                       }, timeout=15)
        assert r.status_code == 200, r.text
        # GET back and verify entry persisted
        r = client.get(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)
        doc = r.json()
        entry = next((e for e in doc["entries"] if e["member_id"] == m0), None)
        assert entry is not None
        assert entry["paid"] is True
        assert entry["amount_paid"] == 40
        assert entry["method"] == "Venmo"
        assert entry["note"] == "partial"
        # summary consistent with the partial: 10 shortfall on this entry + rest unrecorded
        s = doc["summary"]
        expected_out = (50 - 40) + 50 * (len(roster_ids) - 1)
        assert s["outstanding"] == expected_out
        assert s["short_count"] == len(roster_ids)  # partial still counts short
