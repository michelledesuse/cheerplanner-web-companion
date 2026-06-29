"""Calendar feed + bulk-payment auto-allocation pytest suite.

Covers:
- GET /api/calendar with various sources (expense_due, competition, hotel, flight, fundraiser)
- POST /api/payments/bulk auto-allocation across oldest unpaid expenses
- Regression: single POST /api/payments still works
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


def _unique_email(prefix="TEST_cal"):
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


def _new_user(session, prefix="TEST_cal"):
    """Create a fresh isolated user for clean calendar/dashboard math.

    Retries on 429 (signup rate-limited at 10/min)."""
    import time as _time
    email = _unique_email(prefix)
    last = None
    for _ in range(7):
        r = session.post(f"{API}/auth/signup", json={
            "email": email, "password": "password123", "name": "Cal Tester"
        })
        last = r
        if r.status_code == 200:
            data = r.json()
            return {"email": email, "token": data["access_token"], "user": data["user"]}
        if r.status_code == 429:
            _time.sleep(11)
            continue
        break
    assert last is not None and last.status_code == 200, (
        f"signup failed after retries: {last.status_code if last else 'no resp'} {last.text if last else ''}"
    )


def _create_athlete(session, token, name="A1"):
    r = session.post(f"{API}/athletes", json={"name": name}, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


def _create_expense(session, token, athlete_id, amount=100.0, category="Tuition",
                    paid=False, incurred_on=None, due_date=None):
    body = {
        "athlete_id": athlete_id,
        "category": category,
        "amount": amount,
        "incurred_on": incurred_on or _today_iso(),
        "paid": paid,
    }
    if due_date:
        body["due_date"] = due_date
    r = session.post(f"{API}/expenses", json=body, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


def _create_competition(session, token, name="TEST_Comp", event_date="2026-06-10",
                        end_date=None, location="Vegas"):
    body = {"name": name, "event_date": event_date, "location": location}
    if end_date:
        body["end_date"] = end_date
    r = session.post(f"{API}/competitions", json=body, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


def _create_booking(session, token, comp_id, btype, **fields):
    body = {"competition_id": comp_id, "type": btype, **fields}
    r = session.post(f"{API}/bookings", json=body, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


def _create_fundraiser(session, token, name="TEST_Fund", amount_raised=50.0,
                       raised_on=None, athlete_id=None):
    body = {"name": name, "amount_raised": amount_raised,
            "raised_on": raised_on or _today_iso()}
    if athlete_id:
        body["athlete_id"] = athlete_id
    r = session.post(f"{API}/fundraisers", json=body, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================
# Calendar tests
# ============================================================
class TestCalendarEmpty:
    def test_empty_user_returns_empty_items(self, session):
        user = _new_user(session, "TEST_cal_empty")
        r = session.get(f"{API}/calendar", headers=H(user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "items" in body
        assert body["items"] == []


class TestCalendarExpenseDue:
    def test_single_expense_due_in_range(self, session):
        user = _new_user(session, "TEST_cal_due")
        a = _create_athlete(session, user["token"], "TEST_due_ath")
        _create_expense(session, user["token"], a["id"],
                        amount=100.0, due_date="2026-06-15")
        r = session.get(
            f"{API}/calendar?start=2026-06-01&end=2026-06-30",
            headers=H(user["token"]),
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        due_items = [x for x in items if x["kind"] == "expense_due"]
        assert len(due_items) == 1
        it = due_items[0]
        assert it["color"] == "#E11D48"
        assert it["date"] == "2026-06-15"
        assert it["athlete_id"] == a["id"]
        assert it.get("amount") == 100.0

    def test_out_of_range_excluded(self, session):
        user = _new_user(session, "TEST_cal_oor")
        a = _create_athlete(session, user["token"], "TEST_oor_ath")
        _create_expense(session, user["token"], a["id"],
                        amount=100.0, due_date="2026-06-15")
        r = session.get(
            f"{API}/calendar?start=2026-07-01&end=2026-07-31",
            headers=H(user["token"]),
        )
        assert r.status_code == 200
        items = r.json()["items"]
        assert items == []

    def test_paid_expense_excluded(self, session):
        user = _new_user(session, "TEST_cal_paid")
        a = _create_athlete(session, user["token"], "TEST_paid_ath")
        # Create paid=True so its due_date should not surface
        _create_expense(session, user["token"], a["id"],
                        amount=100.0, due_date="2026-06-15", paid=True)
        r = session.get(
            f"{API}/calendar?start=2026-06-01&end=2026-06-30",
            headers=H(user["token"]),
        )
        assert r.status_code == 200
        items = r.json()["items"]
        due_items = [x for x in items if x["kind"] == "expense_due"]
        assert due_items == []


class TestCalendarCompetition:
    def test_competition_with_end_date_emits_two_items(self, session):
        user = _new_user(session, "TEST_cal_comp")
        _create_competition(session, user["token"],
                            name="TEST_Worlds", event_date="2026-06-10",
                            end_date="2026-06-12")
        r = session.get(
            f"{API}/calendar?start=2026-06-01&end=2026-06-30",
            headers=H(user["token"]),
        )
        assert r.status_code == 200
        items = r.json()["items"]
        comp_items = [x for x in items if x["kind"] == "competition"]
        # New behavior: span emits one item PER DAY (3 days = 3 items)
        assert len(comp_items) == 3
        for it in comp_items:
            assert it["color"] == "#007CFF"
        dates = sorted([x["date"] for x in comp_items])
        assert dates == ["2026-06-10", "2026-06-11", "2026-06-12"]
        # The "(ends)" item has title containing "ends"
        ends = [x for x in comp_items if "ends" in x["title"].lower()]
        assert len(ends) == 1
        assert ends[0]["date"] == "2026-06-12"


class TestCalendarBookings:
    def test_hotel_booking_emits_checkin_checkout(self, session):
        user = _new_user(session, "TEST_cal_hotel")
        c = _create_competition(session, user["token"],
                                name="TEST_HotelComp", event_date="2026-06-10",
                                end_date="2026-06-12")
        _create_booking(session, user["token"], c["id"], "hotel",
                        provider="Hilton",
                        check_in="2026-06-10", check_out="2026-06-12")
        r = session.get(
            f"{API}/calendar?start=2026-06-01&end=2026-06-30",
            headers=H(user["token"]),
        )
        assert r.status_code == 200
        items = r.json()["items"]
        # New behavior: 3-day hotel span -> checkin + stay + checkout
        kinds = sorted([x["kind"] for x in items if x["kind"].startswith("hotel")])
        assert kinds == ["hotel_checkin", "hotel_checkout", "hotel_stay"]
        for x in items:
            if x["kind"].startswith("hotel"):
                assert x["color"] == "#7C3AED"
        ci = [x for x in items if x["kind"] == "hotel_checkin"][0]
        co = [x for x in items if x["kind"] == "hotel_checkout"][0]
        assert ci["date"] == "2026-06-10"
        assert co["date"] == "2026-06-12"

    def test_flight_booking_emits_depart_return(self, session):
        user = _new_user(session, "TEST_cal_flight")
        c = _create_competition(session, user["token"],
                                name="TEST_FlightComp", event_date="2026-06-10")
        _create_booking(session, user["token"], c["id"], "flight",
                        provider="Delta",
                        depart_time="2026-06-09T08:00",
                        return_depart_time="2026-06-13T18:00")
        r = session.get(
            f"{API}/calendar?start=2026-06-01&end=2026-06-30",
            headers=H(user["token"]),
        )
        assert r.status_code == 200
        items = r.json()["items"]
        kinds = sorted([x["kind"] for x in items if x["kind"].startswith("flight")])
        assert kinds == ["flight_depart", "flight_return"]
        fd = [x for x in items if x["kind"] == "flight_depart"][0]
        fr = [x for x in items if x["kind"] == "flight_return"][0]
        assert fd["date"] == "2026-06-09"  # first 10 chars
        assert fr["date"] == "2026-06-13"
        assert fd["color"] == "#7C3AED"
        assert fr["color"] == "#7C3AED"


class TestCalendarFundraiser:
    def test_fundraiser_emits_item(self, session):
        user = _new_user(session, "TEST_cal_fund")
        _create_fundraiser(session, user["token"], name="TEST_BakeSale",
                           amount_raised=125.5, raised_on="2026-06-05")
        r = session.get(
            f"{API}/calendar?start=2026-06-01&end=2026-06-30",
            headers=H(user["token"]),
        )
        assert r.status_code == 200
        items = r.json()["items"]
        funds = [x for x in items if x["kind"] == "fundraiser"]
        assert len(funds) == 1
        f = funds[0]
        assert f["color"] == "#16A34A"
        assert f["date"] == "2026-06-05"
        assert f.get("amount") == 125.5


class TestCalendarSorting:
    def test_mixed_items_sorted_by_date_asc(self, session):
        user = _new_user(session, "TEST_cal_sort")
        a = _create_athlete(session, user["token"], "TEST_sort_ath")
        # mix dates intentionally out of order
        _create_expense(session, user["token"], a["id"],
                        amount=50.0, due_date="2026-06-20")
        _create_fundraiser(session, user["token"], name="TEST_sort_fund",
                           amount_raised=30.0, raised_on="2026-06-05")
        _create_competition(session, user["token"],
                            name="TEST_sort_comp", event_date="2026-06-15")
        r = session.get(
            f"{API}/calendar?start=2026-06-01&end=2026-06-30",
            headers=H(user["token"]),
        )
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 3
        dates = [x["date"] for x in items]
        assert dates == sorted(dates), f"Items not sorted ascending: {dates}"


# ============================================================
# Bulk payments auto-allocation tests
# ============================================================
class TestBulkPaymentAutoAlloc:
    def test_one_athlete_two_open_expenses_partial(self, session):
        """1 athlete, $50 + $100 open, bulk $120 equal → first paid; second paid_amount=70."""
        user = _new_user(session, "TEST_alloc_1ath")
        a = _create_athlete(session, user["token"], "TEST_alloc_ath")
        # Create oldest first (older due_date)
        e1 = _create_expense(session, user["token"], a["id"],
                             amount=50.0, due_date="2026-01-01")
        e2 = _create_expense(session, user["token"], a["id"],
                             amount=100.0, due_date="2026-02-01")

        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": [a["id"]],
            "amount": 120.0,
            "split_mode": "equal",
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 1
        pmt = rows[0]
        assert pmt["amount"] == 120.0
        applied = pmt.get("applied_expense_ids") or []
        assert set(applied) == {e1["id"], e2["id"]}, applied

        # Verify expenses persisted state
        exps = session.get(
            f"{API}/expenses?athlete_id={a['id']}", headers=H(user["token"])
        ).json()
        m1 = [x for x in exps if x["id"] == e1["id"]][0]
        m2 = [x for x in exps if x["id"] == e2["id"]][0]
        assert m1["paid"] is True
        assert m1["balance_due"] == 0.0
        assert m2["paid"] is False
        assert m2["paid_amount"] == 70.0
        assert m2["balance_due"] == 30.0

    def test_two_athletes_each_one_open_50_bulk_100_equal(self, session):
        """2 athletes (1 open $50 each), bulk $100 equal → each $50, both expenses paid."""
        user = _new_user(session, "TEST_alloc_2ath")
        a1 = _create_athlete(session, user["token"], "TEST_alloc_ath1")
        a2 = _create_athlete(session, user["token"], "TEST_alloc_ath2")
        e1 = _create_expense(session, user["token"], a1["id"], amount=50.0,
                             due_date="2026-01-15")
        e2 = _create_expense(session, user["token"], a2["id"], amount=50.0,
                             due_date="2026-01-15")

        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": [a1["id"], a2["id"]],
            "amount": 100.0,
            "split_mode": "equal",
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 2
        for p in rows:
            assert p["amount"] == 50.0
            assert len(p["applied_expense_ids"]) == 1
        # The applied_expense_ids should match each athlete's own expense
        by_ath = {p["athlete_id"]: p for p in rows}
        assert by_ath[a1["id"]]["applied_expense_ids"] == [e1["id"]]
        assert by_ath[a2["id"]]["applied_expense_ids"] == [e2["id"]]

        # Verify both expenses now paid=true
        for token_ath, eid in [(a1["id"], e1["id"]), (a2["id"], e2["id"])]:
            exps = session.get(
                f"{API}/expenses?athlete_id={token_ath}",
                headers=H(user["token"]),
            ).json()
            mine = [x for x in exps if x["id"] == eid][0]
            assert mine["paid"] is True, mine
            assert mine["balance_due"] == 0.0

    def test_athlete_no_open_expenses_creates_payment_empty_applied(self, session):
        """Athlete with no open expenses → payment created, applied_expense_ids=[]."""
        user = _new_user(session, "TEST_alloc_noexp")
        a = _create_athlete(session, user["token"], "TEST_noexp_ath")
        r = session.post(f"{API}/payments/bulk", json={
            "athlete_ids": [a["id"]],
            "amount": 75.0,
            "split_mode": "equal",
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 1
        assert rows[0]["amount"] == 75.0
        assert rows[0]["applied_expense_ids"] == []


class TestSinglePaymentRegression:
    def test_single_payment_still_works(self, session):
        """POST /api/payments single-endpoint regression."""
        user = _new_user(session, "TEST_alloc_single")
        a = _create_athlete(session, user["token"], "TEST_single_pay_ath")
        r = session.post(f"{API}/payments", json={
            "athlete_id": a["id"],
            "amount": 42.0,
            "paid_on": _today_iso(),
        }, headers=H(user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["amount"] == 42.0
        assert body["athlete_id"] == a["id"]
