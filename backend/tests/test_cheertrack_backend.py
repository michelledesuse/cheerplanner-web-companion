"""CheerTrack backend pytest suite.

Covers: auth, athletes, expenses, payments, competitions, bookings, fundraisers,
dashboard, reminders, user scoping, cascade deletes, _id leak prevention.
"""
import os
import uuid
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") \
    or "https://776ba8fc-fc69-4cf1-aa74-fa7efdaca6ab.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


def _unique_email(prefix="TEST_user"):
    # NOTE: .test TLD is reserved & rejected by email-validator (used by pydantic EmailStr)
    return f"{prefix}_{uuid.uuid4().hex[:10]}@mailinator.com"


def _today_iso():
    return datetime.now(timezone.utc).date().isoformat()


def _future_iso(days):
    return (datetime.now(timezone.utc).date() + timedelta(days=days)).isoformat()


def _future_dt_iso(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


# ---------------- Fixtures ----------------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_a(session):
    """Primary test user (signed up fresh for isolation)."""
    email = _unique_email("TEST_a")
    r = session.post(f"{API}/auth/signup", json={
        "email": email, "password": "password123", "name": "Test A"
    })
    assert r.status_code == 200, f"signup A failed: {r.status_code} {r.text}"
    data = r.json()
    return {"email": email, "password": "password123",
            "token": data["access_token"], "user": data["user"]}


@pytest.fixture(scope="session")
def user_b(session):
    email = _unique_email("TEST_b")
    r = session.post(f"{API}/auth/signup", json={
        "email": email, "password": "password123", "name": "Test B"
    })
    assert r.status_code == 200, f"signup B failed: {r.status_code} {r.text}"
    data = r.json()
    return {"email": email, "password": "password123",
            "token": data["access_token"], "user": data["user"]}


def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _no_mongo_id(obj):
    """Recursively assert no '_id' key present."""
    if isinstance(obj, dict):
        assert "_id" not in obj, f"_id leaked in {obj}"
        for v in obj.values():
            _no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_mongo_id(v)


# ---------------- Health ----------------
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True


# ---------------- Auth ----------------
class TestAuth:
    def test_signup_returns_token_and_user(self, session):
        email = _unique_email("TEST_signup")
        r = session.post(f"{API}/auth/signup", json={
            "email": email, "password": "password123", "name": "Sign Up"
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("token_type") == "bearer"
        assert isinstance(body.get("access_token"), str) and len(body["access_token"]) > 20
        assert body["user"]["email"] == email.lower()
        assert body["user"]["name"] == "Sign Up"
        assert "id" in body["user"]
        _no_mongo_id(body)

    def test_signup_duplicate_email_rejected(self, session, user_a):
        r = session.post(f"{API}/auth/signup", json={
            "email": user_a["email"], "password": "password123"
        })
        assert r.status_code == 400

    def test_login_success(self, session, user_a):
        r = session.post(f"{API}/auth/login", json={
            "email": user_a["email"], "password": user_a["password"]
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == user_a["email"].lower()
        assert body["access_token"]

    def test_login_wrong_password(self, session, user_a):
        r = session.post(f"{API}/auth/login", json={
            "email": user_a["email"], "password": "wrongpass"
        })
        assert r.status_code == 401

    def test_me_returns_current_user(self, session, user_a):
        r = session.get(f"{API}/auth/me", headers=auth_headers(user_a["token"]))
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == user_a["email"].lower()
        assert body["id"] == user_a["user"]["id"]
        _no_mongo_id(body)

    def test_me_no_token(self, session):
        r = session.get(f"{API}/auth/me")
        # HTTPBearer returns 403 by default if header absent in FastAPI
        assert r.status_code in (401, 403)

    def test_me_invalid_token(self, session):
        r = session.get(f"{API}/auth/me",
                        headers={"Authorization": "Bearer not-a-valid-jwt"})
        assert r.status_code == 401


# ---------------- Athletes ----------------
class TestAthletes:
    def test_create_list_update_delete(self, session, user_a):
        h = auth_headers(user_a["token"])
        # Create
        r = session.post(f"{API}/athletes", headers=h, json={
            "name": "TEST_Athlete1", "team": "Senior X", "gym": "Cheer Co"
        })
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["name"] == "TEST_Athlete1"
        assert a["user_id"] == user_a["user"]["id"]
        _no_mongo_id(a)
        ath_id = a["id"]

        # List contains it
        r = session.get(f"{API}/athletes", headers=h)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert ath_id in ids
        _no_mongo_id(r.json())

        # Update
        r = session.patch(f"{API}/athletes/{ath_id}", headers=h, json={"team": "Worlds"})
        assert r.status_code == 200
        assert r.json()["team"] == "Worlds"

        # Delete
        r = session.delete(f"{API}/athletes/{ath_id}", headers=h)
        assert r.status_code == 200
        assert r.json().get("deleted") is True

        # Verify gone
        r = session.get(f"{API}/athletes", headers=h)
        assert ath_id not in [x["id"] for x in r.json()]


# ---------------- Expenses ----------------
class TestExpenses:
    @pytest.fixture(scope="class")
    def athlete(self, session, user_a):
        h = auth_headers(user_a["token"])
        r = session.post(f"{API}/athletes", headers=h, json={"name": "TEST_ExpAthlete"})
        assert r.status_code == 200
        return r.json()

    def test_categories(self, session):
        r = session.get(f"{API}/expenses/categories")
        assert r.status_code == 200
        cats = r.json()["categories"]
        assert isinstance(cats, list)
        assert len(cats) == 12
        for required in ["Tuition", "Gear", "Misc"]:
            assert required in cats

    def test_expense_crud_and_filter(self, session, user_a, athlete):
        h = auth_headers(user_a["token"])
        r = session.post(f"{API}/expenses", headers=h, json={
            "athlete_id": athlete["id"], "category": "Tuition", "amount": 250.0,
            "note": "TEST_note", "incurred_on": _today_iso(),
            "due_date": _future_iso(5), "paid": False,
        })
        assert r.status_code == 200, r.text
        exp = r.json()
        assert exp["amount"] == 250.0
        assert exp["athlete_id"] == athlete["id"]
        _no_mongo_id(exp)
        eid = exp["id"]

        # List by athlete
        r = session.get(f"{API}/expenses", headers=h, params={"athlete_id": athlete["id"]})
        assert r.status_code == 200
        assert eid in [x["id"] for x in r.json()]

        # Patch
        r = session.patch(f"{API}/expenses/{eid}", headers=h, json={"paid": True, "amount": 275.5})
        assert r.status_code == 200
        assert r.json()["paid"] is True
        assert r.json()["amount"] == 275.5

        # Delete
        r = session.delete(f"{API}/expenses/{eid}", headers=h)
        assert r.status_code == 200


# ---------------- Payments ----------------
class TestPayments:
    def test_payment_crud(self, session, user_a):
        h = auth_headers(user_a["token"])
        a = session.post(f"{API}/athletes", headers=h, json={"name": "TEST_PayAth"}).json()
        r = session.post(f"{API}/payments", headers=h, json={
            "athlete_id": a["id"], "amount": 100.0, "paid_on": _today_iso(),
            "method": "Card", "note": "TEST_pay"
        })
        assert r.status_code == 200, r.text
        p = r.json()
        _no_mongo_id(p)
        pid = p["id"]

        r = session.get(f"{API}/payments", headers=h)
        assert r.status_code == 200
        assert pid in [x["id"] for x in r.json()]

        r = session.delete(f"{API}/payments/{pid}", headers=h)
        assert r.status_code == 200


# ---------------- Competitions ----------------
class TestCompetitions:
    def test_competition_crud(self, session, user_a):
        h = auth_headers(user_a["token"])
        r = session.post(f"{API}/competitions", headers=h, json={
            "name": "TEST_Nationals",
            "location": "Orlando, FL",
            "event_date": _future_iso(60),
            "end_date": _future_iso(62),
            "housing_required": True,
            "booking_release_at": _future_dt_iso(5),
            "notes": "TEST",
        })
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["housing_required"] is True
        assert c["booking_release_at"] is not None
        _no_mongo_id(c)
        cid = c["id"]

        # GET single
        r = session.get(f"{API}/competitions/{cid}", headers=h)
        assert r.status_code == 200
        assert r.json()["id"] == cid

        # List
        r = session.get(f"{API}/competitions", headers=h)
        assert r.status_code == 200
        assert cid in [x["id"] for x in r.json()]

        # Patch
        r = session.patch(f"{API}/competitions/{cid}", headers=h, json={"location": "Dallas, TX"})
        assert r.status_code == 200
        assert r.json()["location"] == "Dallas, TX"

        # Delete
        r = session.delete(f"{API}/competitions/{cid}", headers=h)
        assert r.status_code == 200
        r = session.get(f"{API}/competitions/{cid}", headers=h)
        assert r.status_code == 404


# ---------------- Bookings ----------------
class TestBookings:
    def test_booking_types_and_crud(self, session, user_a):
        h = auth_headers(user_a["token"])
        c = session.post(f"{API}/competitions", headers=h, json={
            "name": "TEST_BookComp", "event_date": _future_iso(30)
        }).json()
        cid = c["id"]

        for btype in ("hotel", "car", "flight"):
            payload = {
                "competition_id": cid, "type": btype,
                "provider": f"TEST_{btype}", "cost": 500.0, "amount_paid": 100.0,
                "balance_due_date": _future_iso(10),
            }
            if btype == "hotel":
                payload.update({"check_in": _future_iso(28), "check_out": _future_iso(30),
                                "cancel_by": _future_iso(7)})
            r = session.post(f"{API}/bookings", headers=h, json=payload)
            assert r.status_code == 200, f"{btype}: {r.text}"
            _no_mongo_id(r.json())

        # Invalid type
        r = session.post(f"{API}/bookings", headers=h, json={
            "competition_id": cid, "type": "train"
        })
        assert r.status_code == 400

        # List filtered
        r = session.get(f"{API}/bookings", headers=h, params={"competition_id": cid})
        assert r.status_code == 200
        bookings = r.json()
        assert len(bookings) == 3
        types = sorted([b["type"] for b in bookings])
        assert types == ["car", "flight", "hotel"]

        # Patch one
        bid = bookings[0]["id"]
        r = session.patch(f"{API}/bookings/{bid}", headers=h, json={"amount_paid": 250.0})
        assert r.status_code == 200
        assert r.json()["amount_paid"] == 250.0

        # Delete competition cascades bookings
        r = session.delete(f"{API}/competitions/{cid}", headers=h)
        assert r.status_code == 200
        r = session.get(f"{API}/bookings", headers=h, params={"competition_id": cid})
        assert r.status_code == 200
        assert r.json() == []


# ---------------- Fundraisers ----------------
class TestFundraisers:
    def test_fundraiser_crud(self, session, user_a):
        h = auth_headers(user_a["token"])
        r = session.post(f"{API}/fundraisers", headers=h, json={
            "name": "TEST_CarWash", "amount_raised": 320.50, "raised_on": _today_iso(),
            "note": "TEST"
        })
        assert r.status_code == 200, r.text
        f = r.json()
        _no_mongo_id(f)
        fid = f["id"]

        r = session.get(f"{API}/fundraisers", headers=h)
        assert r.status_code == 200
        assert fid in [x["id"] for x in r.json()]

        r = session.delete(f"{API}/fundraisers/{fid}", headers=h)
        assert r.status_code == 200


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_dashboard_aggregate(self, session, user_a):
        h = auth_headers(user_a["token"])
        # seed
        a = session.post(f"{API}/athletes", headers=h, json={"name": "TEST_DashAth"}).json()
        session.post(f"{API}/expenses", headers=h, json={
            "athlete_id": a["id"], "category": "Gear", "amount": 50.0,
            "incurred_on": _today_iso(), "paid": False
        })
        session.post(f"{API}/payments", headers=h, json={
            "athlete_id": a["id"], "amount": 75.0, "paid_on": _today_iso()
        })
        c = session.post(f"{API}/competitions", headers=h, json={
            "name": "TEST_DashComp", "event_date": _future_iso(45)
        }).json()
        session.post(f"{API}/bookings", headers=h, json={
            "competition_id": c["id"], "type": "hotel", "cost": 800.0, "amount_paid": 200.0,
            "balance_due_date": _future_iso(10),
        })
        session.post(f"{API}/fundraisers", headers=h, json={
            "name": "TEST_Bake", "amount_raised": 100.0, "raised_on": _today_iso()
        })

        r = session.get(f"{API}/dashboard", headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ["athletes_count", "competitions_count", "total_expenses_ytd",
                    "total_payments_ytd", "outstanding_balance", "booking_balance",
                    "unpaid_expense_balance", "month_spend", "total_raised",
                    "next_competition"]:
            assert key in d, f"missing key {key}"
        assert d["athletes_count"] >= 1
        assert d["competitions_count"] >= 1
        assert d["total_expenses_ytd"] >= 50.0
        assert d["total_payments_ytd"] >= 75.0
        assert d["total_raised"] >= 100.0
        assert d["booking_balance"] >= 600.0
        assert d["next_competition"] is not None
        assert d["next_competition"]["name"]
        _no_mongo_id(d)


# ---------------- Reminders ----------------
class TestReminders:
    def test_reminders_categories(self, session, user_a):
        h = auth_headers(user_a["token"])
        # Create assets that trigger each kind
        a = session.post(f"{API}/athletes", headers=h, json={"name": "TEST_RemAth"}).json()
        # expense (unpaid w/ due)
        session.post(f"{API}/expenses", headers=h, json={
            "athlete_id": a["id"], "category": "Tuition", "amount": 200.0,
            "incurred_on": _today_iso(), "due_date": _future_iso(3), "paid": False
        })
        c = session.post(f"{API}/competitions", headers=h, json={
            "name": "TEST_RemComp", "event_date": _future_iso(20),
            "booking_release_at": _future_dt_iso(2)
        }).json()
        # booking balance > 0
        session.post(f"{API}/bookings", headers=h, json={
            "competition_id": c["id"], "type": "hotel", "provider": "TEST Hotel",
            "cost": 600.0, "amount_paid": 100.0,
            "balance_due_date": _future_iso(7),
            "cancel_by": _future_iso(5)
        })

        r = session.get(f"{API}/reminders", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "items" in body and "today" in body
        kinds = {item["kind"] for item in body["items"]}
        # All four kinds should be present given seeded data
        assert "expense" in kinds
        assert "booking" in kinds
        assert "booking_release" in kinds
        assert "cancel_by" in kinds

        # Sorted by days_until ascending
        days = [it["days_until"] for it in body["items"]]
        assert days == sorted(days)
        _no_mongo_id(body)

    def test_reminders_exclude_zero_balance_booking(self, session, user_a):
        h = auth_headers(user_a["token"])
        c = session.post(f"{API}/competitions", headers=h, json={
            "name": "TEST_ZeroBal", "event_date": _future_iso(40)
        }).json()
        # cost == amount_paid => balance 0, should NOT appear as booking reminder
        b = session.post(f"{API}/bookings", headers=h, json={
            "competition_id": c["id"], "type": "car",
            "cost": 200.0, "amount_paid": 200.0,
            "balance_due_date": _future_iso(4),
        }).json()
        r = session.get(f"{API}/reminders", headers=h)
        ids = [it["id"] for it in r.json()["items"]]
        assert f"booking:{b['id']}" not in ids


# ---------------- User Scoping ----------------
class TestUserScoping:
    def test_user_a_cannot_access_user_b_athlete(self, session, user_a, user_b):
        ha = auth_headers(user_a["token"])
        hb = auth_headers(user_b["token"])
        # Create athlete as A
        a = session.post(f"{API}/athletes", headers=ha, json={"name": "TEST_ScopeAth"}).json()
        aid = a["id"]

        # B's list should not contain A's athlete
        r = session.get(f"{API}/athletes", headers=hb)
        assert aid not in [x["id"] for x in r.json()]

        # B cannot patch A's athlete
        r = session.patch(f"{API}/athletes/{aid}", headers=hb, json={"team": "Hacked"})
        assert r.status_code == 404

        # B cannot delete A's athlete
        r = session.delete(f"{API}/athletes/{aid}", headers=hb)
        assert r.status_code == 404

        # A can still see/edit it
        r = session.patch(f"{API}/athletes/{aid}", headers=ha, json={"team": "Mine"})
        assert r.status_code == 200

    def test_user_a_cannot_access_user_b_competition(self, session, user_a, user_b):
        ha = auth_headers(user_a["token"])
        hb = auth_headers(user_b["token"])
        c = session.post(f"{API}/competitions", headers=ha, json={
            "name": "TEST_ScopeComp", "event_date": _future_iso(15)
        }).json()
        cid = c["id"]
        r = session.get(f"{API}/competitions/{cid}", headers=hb)
        assert r.status_code == 404
        r = session.patch(f"{API}/competitions/{cid}", headers=hb, json={"name": "x"})
        assert r.status_code == 404


# ---------------- Cascade Deletes ----------------
class TestCascadeDeletes:
    def test_delete_athlete_cascades_expenses_and_payments(self, session, user_a):
        h = auth_headers(user_a["token"])
        a = session.post(f"{API}/athletes", headers=h, json={"name": "TEST_CascadeAth"}).json()
        aid = a["id"]
        e = session.post(f"{API}/expenses", headers=h, json={
            "athlete_id": aid, "category": "Gear", "amount": 30.0,
            "incurred_on": _today_iso()
        }).json()
        p = session.post(f"{API}/payments", headers=h, json={
            "athlete_id": aid, "amount": 25.0, "paid_on": _today_iso()
        }).json()
        # Delete athlete
        r = session.delete(f"{API}/athletes/{aid}", headers=h)
        assert r.status_code == 200

        # Expenses/payments for that athlete should be gone
        r = session.get(f"{API}/expenses", headers=h, params={"athlete_id": aid})
        assert e["id"] not in [x["id"] for x in r.json()]
        r = session.get(f"{API}/payments", headers=h, params={"athlete_id": aid})
        assert p["id"] not in [x["id"] for x in r.json()]

    def test_delete_competition_cascades_bookings(self, session, user_a):
        h = auth_headers(user_a["token"])
        c = session.post(f"{API}/competitions", headers=h, json={
            "name": "TEST_CascadeComp", "event_date": _future_iso(20)
        }).json()
        cid = c["id"]
        b = session.post(f"{API}/bookings", headers=h, json={
            "competition_id": cid, "type": "hotel", "cost": 100.0
        }).json()
        r = session.delete(f"{API}/competitions/{cid}", headers=h)
        assert r.status_code == 200
        r = session.get(f"{API}/bookings", headers=h, params={"competition_id": cid})
        assert b["id"] not in [x["id"] for x in r.json()]
