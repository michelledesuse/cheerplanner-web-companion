"""Iteration 51 backend tests.

CAL-1: GET /api/calendar sorted chronologically per day — all-day items first
       (no `time`), then timed items ascending by 24h.
F2:   GET /api/dashboard `due_today` = unpaid expenses + positive booking
      balances with due date <= today (due today + overdue).
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


def _hhmm(v):
    if not v:
        return ""
    s = str(v)
    # accept HH:MM or HH:MM:SS or full ISO w/ T
    if "T" in s:
        s = s.split("T", 1)[1]
    return s[:5]


class TestCal1Sort:
    def test_calendar_sorted_all_day_first_then_time_ascending(self, headers):
        """For every day-grouping, all-day items (no time) must precede timed
        items, and timed items must be ascending by 24h HH:MM."""
        # Fetch a wide window so we get plenty of days to inspect.
        r = requests.get(
            f"{BASE_URL}/api/calendar",
            params={"start": "2024-01-01", "end": "2027-12-31"},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text[:300]
        items = r.json().get("items", [])
        assert isinstance(items, list) and len(items) > 0

        # Group by date
        by_day = {}
        for it in items:
            by_day.setdefault(it["date"], []).append(it)

        checked_days = 0
        for day, its in by_day.items():
            times = [_hhmm(x.get("time")) for x in its]
            # 1) all empty times come before any non-empty in the returned order
            saw_timed = False
            for t in times:
                if t:
                    saw_timed = True
                else:
                    assert not saw_timed, (
                        f"All-day item after timed on {day}: {times}"
                    )
            # 2) timed times are ascending
            timed = [t for t in times if t]
            assert timed == sorted(timed), (
                f"Timed items not ascending on {day}: {timed}"
            )
            checked_days += 1
        assert checked_days > 0

    def test_calendar_has_day_with_multiple_timed_events_sorted(self, headers):
        """Find at least one day with 2+ timed events and confirm ascending."""
        r = requests.get(
            f"{BASE_URL}/api/calendar",
            params={"start": "2024-01-01", "end": "2027-12-31"},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200
        items = r.json()["items"]
        by_day = {}
        for it in items:
            by_day.setdefault(it["date"], []).append(it)
        multi = [(d, [_hhmm(x.get("time")) for x in its])
                 for d, its in by_day.items()
                 if sum(1 for x in its if x.get("time")) >= 2]
        assert multi, "No day with >=2 timed events found (seed data expected to include some)."
        for d, times in multi:
            timed = [t for t in times if t]
            assert timed == sorted(timed), f"{d}: {timed} not ascending"


class TestF2DueToday:
    def test_dashboard_due_today_matches_due_or_overdue_sum(self, headers):
        # Dashboard
        r = requests.get(f"{BASE_URL}/api/dashboard", headers=headers, timeout=20)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "due_today" in d
        due_today = float(d["due_today"])
        assert due_today >= 0

        # Compute expected from expenses + bookings
        from datetime import datetime, timezone
        today_iso = datetime.now(timezone.utc).date().isoformat()

        exp_r = requests.get(f"{BASE_URL}/api/expenses", headers=headers, timeout=20)
        assert exp_r.status_code == 200
        expenses = exp_r.json()
        expected = 0.0
        for e in expenses:
            amt = float(e.get("amount") or 0)
            paid_amt = float(e.get("paid_amount") or 0)
            if e.get("paid") and paid_amt < amt:
                paid_amt = amt
            bal = max(0.0, amt - paid_amt)
            dd = str(e.get("due_date") or "")[:10]
            if bal > 0 and dd and dd <= today_iso:
                expected += bal

        bk_r = requests.get(f"{BASE_URL}/api/bookings", headers=headers, timeout=20)
        if bk_r.status_code == 200:
            for b in bk_r.json():
                cost = float(b.get("cost") or 0)
                paid = float(b.get("amount_paid") or 0)
                bal = cost - paid
                bdd = str(b.get("balance_due_date") or "")[:10]
                if bal > 0 and bdd and bdd <= today_iso:
                    expected += bal

        assert abs(due_today - round(expected, 2)) < 0.02, (
            f"due_today={due_today} vs expected≈{round(expected, 2)}"
        )

    def test_dashboard_due_today_includes_overdue(self, headers):
        """Verify that due_today includes past-due items (due_date < today)."""
        from datetime import datetime, timezone
        today_iso = datetime.now(timezone.utc).date().isoformat()

        exp_r = requests.get(f"{BASE_URL}/api/expenses", headers=headers, timeout=20)
        expenses = exp_r.json()
        overdue_sum = 0.0
        for e in expenses:
            amt = float(e.get("amount") or 0)
            paid = float(e.get("paid_amount") or 0)
            if e.get("paid") and paid < amt:
                paid = amt
            bal = max(0.0, amt - paid)
            dd = str(e.get("due_date") or "")[:10]
            if bal > 0 and dd and dd < today_iso:
                overdue_sum += bal

        r = requests.get(f"{BASE_URL}/api/dashboard", headers=headers, timeout=20)
        due_today = float(r.json()["due_today"])
        # If seed data has overdue items, due_today must be at least that.
        assert due_today + 0.01 >= overdue_sum, (
            f"due_today={due_today} must include overdue={overdue_sum}"
        )
