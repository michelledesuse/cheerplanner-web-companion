"""Iter72: Payment tracker outstanding/expected_total include per-member
amount_due for UNPAID members too (not just paid). Also regression check that
paid, exempt, default-per-person, and multi-attach still compute correctly.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to the value used by the tests directory convention
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def roster_members(client):
    """Ensure we have at least 3 non-parent roster members to test with.
    Reuse existing non-parent members; create TEST_ ones if not enough.
    """
    r = client.get(f"{BASE_URL}/api/roster", timeout=15)
    assert r.status_code == 200, r.text
    all_roster = r.json()
    non_parent = [m for m in all_roster if m.get("role") != "parent"]
    created = []
    while len(non_parent) < 3:
        nm = client.post(
            f"{BASE_URL}/api/roster",
            json={"name": f"TEST_iter72_{uuid.uuid4().hex[:6]}", "role": "athlete"},
            timeout=15,
        )
        assert nm.status_code in (200, 201), nm.text
        created.append(nm.json()["id"])
        non_parent.append(nm.json())
    yield non_parent[:3]
    for cid in created:
        client.delete(f"{BASE_URL}/api/roster/{cid}", timeout=15)


@pytest.fixture
def tracker(client):
    """Create a tracker with NO default amount, cleaned up after test."""
    r = client.post(
        f"{BASE_URL}/api/team/payments",
        json={"name": f"TEST_iter72_{uuid.uuid4().hex[:6]}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    yield tid
    client.delete(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)


def _get(client, tid):
    r = client.get(f"{BASE_URL}/api/team/payments/{tid}", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _set_member(client, tid, mid, body):
    r = client.put(
        f"{BASE_URL}/api/team/payments/{tid}/member/{mid}", json=body, timeout=15
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- Core bug-fix tests ----------------

class TestUnpaidAmountDueIncluded:
    """UNPAID members with amount_due must show up in outstanding + expected_total."""

    def test_single_unpaid_amount_due_50(self, client, tracker, roster_members):
        m1 = roster_members[0]
        res = _set_member(client, tracker, m1["id"], {"amount_due": 50})
        s = res["summary"]
        assert s["outstanding"] == 50.0, f"expected 50, got {s['outstanding']} full={s}"
        assert s["expected_total"] == 50.0, f"expected_total 50, got {s['expected_total']}"
        assert s["short_count"] >= 1
        assert s["paid_count"] == 0

    def test_two_unpaid_amount_due_sum(self, client, tracker, roster_members):
        m1, m2 = roster_members[0], roster_members[1]
        _set_member(client, tracker, m1["id"], {"amount_due": 50})
        res = _set_member(client, tracker, m2["id"], {"amount_due": 30})
        s = res["summary"]
        assert s["outstanding"] == 80.0, f"expected 80, got {s['outstanding']}"
        assert s["expected_total"] == 80.0
        assert s["paid_count"] == 0

    def test_paid_reduces_outstanding(self, client, tracker, roster_members):
        m1, m2 = roster_members[0], roster_members[1]
        _set_member(client, tracker, m1["id"], {"amount_due": 50})
        _set_member(client, tracker, m2["id"], {"amount_due": 30})
        # Mark m1 paid with amount_paid 50
        res = _set_member(client, tracker, m1["id"], {"paid": True, "amount_paid": 50, "amount_due": 50})
        s = res["summary"]
        assert s["outstanding"] == 30.0, f"expected 30, got {s['outstanding']} full={s}"
        assert s["expected_total"] == 80.0
        assert s["paid_count"] == 1


# ---------------- Regression tests ----------------

class TestRegression:

    def test_paid_with_amount_paid_only(self, client, tracker, roster_members):
        """Tracker with default amount: paying full amount_paid clears outstanding for that member."""
        # Patch default amount to 100
        r = client.patch(
            f"{BASE_URL}/api/team/payments/{tracker}", json={"amount": 100}, timeout=15
        )
        assert r.status_code == 200
        m1 = roster_members[0]
        res = _set_member(client, tracker, m1["id"], {"paid": True, "amount_paid": 100})
        s = res["summary"]
        assert s["paid_count"] == 1
        # collected should include the 100
        assert s["collected"] == 100.0

    def test_amount_due_for_paid_member(self, client, tracker, roster_members):
        """Per-member amount_due for PAID member counts toward expected_total."""
        m1 = roster_members[0]
        # Mark paid with amount_due=75 amount_paid=75 (fully covers)
        res = _set_member(client, tracker, m1["id"], {"paid": True, "amount_due": 75, "amount_paid": 75})
        s = res["summary"]
        # expected_total counts this 75
        assert s["expected_total"] >= 75.0
        # This member is covered (paid_amt>=due) so contributes 0 outstanding
        # But default may be None -> only counted if amount OR any amount_due set
        # And other members with no entry contribute default (which we haven't set here)
        # So outstanding should be 0
        assert s["outstanding"] == 0.0, f"expected 0, got {s['outstanding']} full={s}"

    def test_exempt_member_excluded_from_totals(self, client, tracker, roster_members):
        m1, m2 = roster_members[0], roster_members[1]
        _set_member(client, tracker, m1["id"], {"amount_due": 50})
        _set_member(client, tracker, m2["id"], {"amount_due": 30})
        # exclude m2
        r = client.put(
            f"{BASE_URL}/api/team/payments/{tracker}/member/{m2['id']}/exclude",
            json={"excluded": True}, timeout=15,
        )
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        # m2's 30 removed from expected_total & outstanding
        assert s["outstanding"] == 50.0, f"expected 50, got {s['outstanding']} full={s}"
        assert s["expected_total"] == 50.0
        assert s["excluded_count"] >= 1

    def test_default_amount_per_person_applied_no_entry(self, client, tracker, roster_members):
        """When default 'amount' is set and members have no entry, they still owe default."""
        r = client.patch(
            f"{BASE_URL}/api/team/payments/{tracker}", json={"amount": 20}, timeout=15
        )
        assert r.status_code == 200
        s = _get(client, tracker)["summary"]
        # Every non-parent roster member with NO entry owes 20
        member_total = s["member_total"]
        assert s["expected_total"] == 20.0 * member_total
        assert s["outstanding"] == 20.0 * member_total

    def test_multi_attach_persists(self, client, tracker):
        """Regression: PATCH with competition_ids/event_ids arrays still saves."""
        r = client.patch(
            f"{BASE_URL}/api/team/payments/{tracker}",
            json={"competition_ids": ["abc123"], "event_ids": ["evt456"]},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        got = _get(client, tracker)
        assert "abc123" in (got.get("competition_ids") or [])
        assert "evt456" in (got.get("event_ids") or [])
