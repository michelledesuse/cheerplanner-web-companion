"""Flight date normalization (calendar) + Expense edit pytest suite (iteration 7).

Validates:
- GET /api/calendar normalizes flight booking dates of various formats
  (ISO, DD-MM-YYYY[ HH:MM], DD/MM/YYYY, garbage) before emitting items.
- PATCH /api/expenses/{id} updates fields and is reflected in subsequent GET.
- Error scenarios for PATCH (no fields, non-existent, cross-user).
- After PATCH paid=true, apply-payment returns 400 already-paid.
"""
import os
import uuid
import time

import pytest
import requests


BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://athlete-expense-hub.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"


def _unique_email(prefix="TEST_it7"):
    return f"{prefix}_{uuid.uuid4().hex[:10]}@mailinator.com"


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ----- fixtures / helpers -----
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _new_user(session, prefix="TEST_it7"):
    email = _unique_email(prefix)
    last = None
    for _ in range(7):
        r = session.post(f"{API}/auth/signup", json={
            "email": email, "password": "password123", "name": "Flight/Expense Tester"
        })
        last = r
        if r.status_code == 200:
            data = r.json()
            return {"email": email, "token": data["access_token"], "user": data["user"]}
        if r.status_code == 429:
            time.sleep(11)
            continue
        break
    assert last is not None and last.status_code == 200, (
        f"signup failed: {last.status_code if last else 'no resp'} {last.text if last else ''}"
    )


def _create_athlete(session, token, name="A1", **extra):
    body = {"name": name, **extra}
    r = session.post(f"{API}/athletes", json=body, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


def _create_competition(session, token, name="TEST_Comp",
                        event_date="2026-09-10", end_date=None, location="Orlando"):
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


def _create_expense(session, token, athlete_id, **extra):
    body = {
        "athlete_id": athlete_id,
        "category": "Travel",
        "amount": 100.0,
        "incurred_on": "2026-09-01",
        **extra,
    }
    r = session.post(f"{API}/expenses", json=body, headers=H(token))
    assert r.status_code == 200, r.text
    return r.json()


def _flight_items(items):
    return [x for x in items if x["kind"] in ("flight_depart", "flight_return", "travel_day")]


# ============================================================
# Section 1 — Flight date normalization on /calendar
# ============================================================
class TestFlightCalendarNormalize:
    def test_1_iso_depart_only(self, session):
        """ISO depart_time only → one flight_depart on the ISO date."""
        u = _new_user(session, "TEST_it7_f1")
        c = _create_competition(session, u["token"], name="TEST_F1",
                                event_date="2026-09-10")
        _create_booking(session, u["token"], c["id"], "flight",
                        provider="Delta", depart_time="2026-09-10T08:00")
        r = session.get(f"{API}/calendar?start=2026-09-01&end=2026-09-30",
                        headers=H(u["token"]))
        assert r.status_code == 200, r.text
        fi = _flight_items(r.json()["items"])
        assert len(fi) == 1, fi
        assert fi[0]["kind"] == "flight_depart"
        assert fi[0]["date"] == "2026-09-10"
        assert fi[0]["color"] == "#7C3AED"

    def test_2_dd_mm_yyyy_with_time_both_legs(self, session):
        """DD-MM-YYYY HH:MM both legs → depart + return + travel days."""
        u = _new_user(session, "TEST_it7_f2")
        c = _create_competition(session, u["token"], name="TEST_F2",
                                event_date="2026-09-10", end_date="2026-09-12")
        _create_booking(session, u["token"], c["id"], "flight",
                        provider="Delta",
                        depart_time="10-09-2026 08:30",
                        return_depart_time="13-09-2026 18:00")
        r = session.get(f"{API}/calendar?start=2026-09-01&end=2026-09-30",
                        headers=H(u["token"]))
        assert r.status_code == 200, r.text
        fi = _flight_items(r.json()["items"])
        # depart Sep 10, return Sep 13, travel days Sep 11 + 12 → 4 items
        assert len(fi) == 4, fi
        by_date = {x["date"]: x for x in fi}
        assert by_date["2026-09-10"]["kind"] == "flight_depart"
        assert by_date["2026-09-11"]["kind"] == "travel_day"
        assert by_date["2026-09-12"]["kind"] == "travel_day"
        assert by_date["2026-09-13"]["kind"] == "flight_return"
        for it in fi:
            assert it["color"] == "#7C3AED"

    def test_3_dd_slash_mm_slash_yyyy(self, session):
        """DD/MM/YYYY format → normalized."""
        u = _new_user(session, "TEST_it7_f3")
        c = _create_competition(session, u["token"], name="TEST_F3",
                                event_date="2026-09-10")
        _create_booking(session, u["token"], c["id"], "flight",
                        provider="Delta", depart_time="10/09/2026")
        r = session.get(f"{API}/calendar?start=2026-09-01&end=2026-09-30",
                        headers=H(u["token"]))
        assert r.status_code == 200, r.text
        fi = _flight_items(r.json()["items"])
        assert len(fi) == 1, fi
        assert fi[0]["kind"] == "flight_depart"
        assert fi[0]["date"] == "2026-09-10"

    def test_4_garbage_string_no_flight_events(self, session):
        """Garbage depart_time → 200 with no flight events (no 500)."""
        u = _new_user(session, "TEST_it7_f4")
        c = _create_competition(session, u["token"], name="TEST_F4",
                                event_date="2026-09-10")
        _create_booking(session, u["token"], c["id"], "flight",
                        provider="Delta", depart_time="sometime next month")
        r = session.get(f"{API}/calendar?start=2026-09-01&end=2026-09-30",
                        headers=H(u["token"]))
        assert r.status_code == 200, r.text
        fi = _flight_items(r.json()["items"])
        assert fi == [], fi

    def test_5_outbound_only_dd_mm_yyyy_no_travel_day(self, session):
        """DD-MM-YYYY outbound only, no return → 1 flight_depart, 0 travel_day."""
        u = _new_user(session, "TEST_it7_f5")
        c = _create_competition(session, u["token"], name="TEST_F5",
                                event_date="2026-09-10")
        _create_booking(session, u["token"], c["id"], "flight",
                        provider="Delta", depart_time="10-09-2026")
        r = session.get(f"{API}/calendar?start=2026-09-01&end=2026-09-30",
                        headers=H(u["token"]))
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        fi = _flight_items(items)
        assert len(fi) == 1, fi
        assert fi[0]["kind"] == "flight_depart"
        assert fi[0]["date"] == "2026-09-10"
        assert not any(x["kind"] == "travel_day" for x in items)
        assert not any(x["kind"] == "flight_return" for x in items)

    def test_6_mixed_iso_hotel_plus_dd_mm_yyyy_flight(self, session):
        """ISO hotel + DD-MM-YYYY flight together → both render correctly."""
        u = _new_user(session, "TEST_it7_f6")
        c = _create_competition(session, u["token"], name="TEST_F6",
                                event_date="2026-09-10", end_date="2026-09-12")
        _create_booking(session, u["token"], c["id"], "hotel", provider="Hilton",
                        check_in="2026-09-09", check_out="2026-09-13")
        _create_booking(session, u["token"], c["id"], "flight", provider="AA",
                        depart_time="09-09-2026 06:00",
                        return_depart_time="13-09-2026 20:00")
        r = session.get(f"{API}/calendar?start=2026-09-01&end=2026-09-30",
                        headers=H(u["token"]))
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        hotel_items = [x for x in items if x["kind"].startswith("hotel")]
        # 5 nights hotel (09->13) inclusive = 5 days
        assert len(hotel_items) == 5, hotel_items
        hotel_dates = sorted([x["date"] for x in hotel_items])
        assert hotel_dates == ["2026-09-09", "2026-09-10", "2026-09-11",
                               "2026-09-12", "2026-09-13"]
        fi = _flight_items(items)
        by_date = {x["date"]: x for x in fi}
        assert by_date["2026-09-09"]["kind"] == "flight_depart"
        assert by_date["2026-09-13"]["kind"] == "flight_return"
        assert by_date["2026-09-10"]["kind"] == "travel_day"
        assert by_date["2026-09-11"]["kind"] == "travel_day"
        assert by_date["2026-09-12"]["kind"] == "travel_day"
        # All sorted ascending
        dates = [x["date"] for x in items]
        assert dates == sorted(dates)


# ============================================================
# Section 2 — Expense PATCH editing
# ============================================================
class TestExpenseEdit:
    def test_7_patch_amount_updates_and_recomputes_balance(self, session):
        u = _new_user(session, "TEST_it7_e7")
        a = _create_athlete(session, u["token"], name="TEST_E7_Ath")
        exp = _create_expense(session, u["token"], a["id"], amount=100.0)
        assert exp["amount"] == 100.0
        # PATCH new amount
        r = session.patch(f"{API}/expenses/{exp['id']}",
                          json={"amount": 250.0}, headers=H(u["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["amount"] == 250.0
        assert body["paid_amount"] == 0.0
        assert body["balance_due"] == 250.0
        # GET reflects via list
        rl = session.get(f"{API}/expenses", headers=H(u["token"]))
        assert rl.status_code == 200, rl.text
        match = [e for e in rl.json() if e["id"] == exp["id"]]
        assert len(match) == 1
        assert match[0]["amount"] == 250.0
        assert match[0]["balance_due"] == 250.0

    def test_8_patch_category_and_note(self, session):
        u = _new_user(session, "TEST_it7_e8")
        a = _create_athlete(session, u["token"], name="TEST_E8_Ath")
        exp = _create_expense(session, u["token"], a["id"],
                              category="Travel", note="orig")
        r = session.patch(f"{API}/expenses/{exp['id']}",
                          json={"category": "Lodging", "note": "updated note"},
                          headers=H(u["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["category"] == "Lodging"
        assert body["note"] == "updated note"
        # GET reflects
        rl = session.get(f"{API}/expenses", headers=H(u["token"])).json()
        match = [e for e in rl if e["id"] == exp["id"]][0]
        assert match["category"] == "Lodging"
        assert match["note"] == "updated note"

    def test_9_patch_paid_true_marks_paid_balance_zero(self, session):
        u = _new_user(session, "TEST_it7_e9")
        a = _create_athlete(session, u["token"], name="TEST_E9_Ath")
        exp = _create_expense(session, u["token"], a["id"], amount=200.0)
        r = session.patch(f"{API}/expenses/{exp['id']}",
                          json={"paid": True}, headers=H(u["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["paid"] is True
        assert body["balance_due"] == 0.0
        # GET reflects
        rl = session.get(f"{API}/expenses", headers=H(u["token"])).json()
        match = [e for e in rl if e["id"] == exp["id"]][0]
        assert match["paid"] is True
        assert match["balance_due"] == 0.0

    def test_10_patch_empty_body_returns_400(self, session):
        u = _new_user(session, "TEST_it7_e10")
        a = _create_athlete(session, u["token"], name="TEST_E10_Ath")
        exp = _create_expense(session, u["token"], a["id"])
        r = session.patch(f"{API}/expenses/{exp['id']}",
                          json={}, headers=H(u["token"]))
        assert r.status_code == 400, r.text

    def test_11_patch_nonexistent_returns_404(self, session):
        u = _new_user(session, "TEST_it7_e11")
        r = session.patch(f"{API}/expenses/nonexistent-id-12345",
                          json={"amount": 99.0}, headers=H(u["token"]))
        assert r.status_code == 404, r.text

    def test_12_patch_cross_user_returns_404(self, session):
        u1 = _new_user(session, "TEST_it7_e12a")
        u2 = _new_user(session, "TEST_it7_e12b")
        a = _create_athlete(session, u1["token"], name="TEST_E12_Ath")
        exp = _create_expense(session, u1["token"], a["id"])
        # u2 tries to update u1's expense
        r = session.patch(f"{API}/expenses/{exp['id']}",
                          json={"amount": 999.0}, headers=H(u2["token"]))
        assert r.status_code == 404, r.text
        # confirm original unchanged
        rl = session.get(f"{API}/expenses", headers=H(u1["token"])).json()
        match = [e for e in rl if e["id"] == exp["id"]][0]
        assert match["amount"] == 100.0

    def test_13_apply_payment_after_paid_true_returns_400(self, session):
        u = _new_user(session, "TEST_it7_e13")
        a = _create_athlete(session, u["token"], name="TEST_E13_Ath")
        exp = _create_expense(session, u["token"], a["id"], amount=150.0)
        # PATCH paid=true
        r = session.patch(f"{API}/expenses/{exp['id']}",
                          json={"paid": True}, headers=H(u["token"]))
        assert r.status_code == 200, r.text
        # Now apply-payment → should be 400 "already fully paid"
        r2 = session.post(f"{API}/expenses/{exp['id']}/apply-payment",
                          json={"amount": 25.0, "source_type": "manual"},
                          headers=H(u["token"]))
        assert r2.status_code == 400, r2.text
        assert "already fully paid" in r2.text.lower()
