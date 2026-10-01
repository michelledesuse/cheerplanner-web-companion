"""Iter 140 tests:
- Email-flow pages render brand BLUE (#007CFF), not red (#E11D48)
- Smart Inbox /inbox/parse splits a combined itinerary into multiple drafts
- A simple expense still becomes one expense draft
- Garbage text yields a single 'unknown' draft
- No regression on demo login, /competitions, /inbox/drafts
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASSWORD = "CheerDemo2026!"

COMBINED_ITINERARY = """Your Trip Confirmation — Spirit Nationals (ORD → MCO)

FLIGHT (round trip) — United Airlines, Confirmation UA7XKZ2
Outbound: UA1234 Chicago O'Hare (ORD) → Orlando (MCO)
Depart: 2026-03-05 06:30
Arrive: 2026-03-05 10:12
Return:  UA4321 Orlando (MCO) → Chicago O'Hare (ORD)
Depart: 2026-03-08 18:45
Arrive: 2026-03-08 21:05
Passenger: Emma Johnson
Seat: 14C outbound, 12A return
Total: $482.60 (outbound $236.30, return $246.30)

HOTEL — Hyatt Regency Orlando, Confirmation HY-99812
Address: 9801 International Dr, Orlando, FL 32819
Check-in: 2026-03-05 after 16:00
Check-out: 2026-03-08 before 11:00
2 nights, King room, Guest Emma Johnson
Free cancellation until 2026-03-01
Total: $612.44 (taxes/fees incl.)

RENTAL CAR — Enterprise, Confirmation ENT-50021
Pickup:  2026-03-05 10:45 at MCO Airport
Drop-off: 2026-03-08 17:30 at MCO Airport
Compact SUV, driver Emma Johnson
Total: $184.22
"""

SIMPLE_RECEIPT = """Starbucks Store #1023
Date: 2026-01-15
Grande Latte $5.75
Blueberry Muffin $3.50
Subtotal: $9.25
Tax: $0.74
Total: $9.99
Visa **** 1234"""

GARBAGE_TEXT = "asdf qwerty 1234 ???"


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"demo login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ---------------- Email-flow brand color ---------------- #
class TestEmailPagesBlue:
    def test_opt_in_page_brand_blue(self):
        r = requests.get(f"{BASE_URL}/api/notifications/opt-in", timeout=20)
        assert r.status_code == 200
        html = r.text
        assert "#007CFF" in html, "opt-in page is missing brand blue #007CFF"
        assert "#E11D48" not in html, "opt-in page still contains red #E11D48"

    def test_reset_invalid_token_page_brand_blue(self):
        r = requests.get(f"{BASE_URL}/api/auth/reset", params={"token": "bad"}, timeout=20)
        assert r.status_code == 400
        html = r.text
        assert "#007CFF" in html, "reset-invalid page is missing #007CFF"
        assert "#E11D48" not in html, "reset-invalid page still contains red #E11D48"

    def test_unsubscribe_invalid_page_brand_blue(self):
        r = requests.get(f"{BASE_URL}/api/notifications/unsubscribe", params={"token": "bad"}, timeout=20)
        assert r.status_code == 400
        html = r.text
        assert "#007CFF" in html
        assert "#E11D48" not in html


# ---------------- Regression ---------------- #
class TestRegression:
    def test_demo_login_200(self, auth_session):
        assert auth_session.headers.get("Authorization")

    def test_competitions_200(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/competitions", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_inbox_drafts_200(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/inbox/drafts", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------- Inbox parse: split + types ---------------- #
class TestInboxParseSplit:
    created_ids: list = []

    def _delete(self, session, ids):
        for i in ids:
            try:
                session.delete(f"{BASE_URL}/api/inbox/drafts/{i}", timeout=15)
            except Exception:
                pass

    def test_combined_itinerary_splits_into_three(self, auth_session):
        r = auth_session.post(
            f"{BASE_URL}/api/inbox/parse",
            json={"text": COMBINED_ITINERARY, "source": "paste"},
            timeout=90,
        )
        assert r.status_code == 200, f"parse failed: {r.status_code} {r.text[:400]}"
        drafts = r.json()
        assert isinstance(drafts, list), "response must be a list"
        ids = [d["id"] for d in drafts]
        try:
            assert len(drafts) == 3, f"expected 3 drafts, got {len(drafts)}: " + ", ".join(d.get("summary", "") for d in drafts)
            kinds = [d.get("kind") for d in drafts]
            assert all(k == "booking" for k in kinds), f"all should be bookings, got {kinds}"
            types = sorted([(d.get("data") or {}).get("type") for d in drafts])
            assert types == ["car", "flight", "hotel"], f"expected [car, flight, hotel], got {types}"

            by_type = {(d.get("data") or {}).get("type"): (d.get("data") or {}) for d in drafts}

            flight = by_type["flight"]
            flight_populated = sum(
                1 for k in ("flight_number", "depart_airport", "arrive_airport",
                            "depart_time", "arrive_time",
                            "return_flight_number", "return_depart_airport",
                            "return_arrive_airport", "return_depart_time", "return_arrive_time")
                if flight.get(k)
            )
            assert flight_populated >= 6, f"flight draft under-populated: {flight}"

            hotel = by_type["hotel"]
            hotel_populated = sum(
                1 for k in ("address", "check_in", "check_out", "cancel_by",
                            "check_in_time", "check_out_time", "provider")
                if hotel.get(k)
            )
            assert hotel_populated >= 4, f"hotel draft under-populated: {hotel}"

            car = by_type["car"]
            car_populated = sum(
                1 for k in ("pickup_at", "pickup_location", "dropoff_at", "dropoff_location", "provider")
                if car.get(k)
            )
            assert car_populated >= 3, f"car draft under-populated: {car}"
        finally:
            self._delete(auth_session, ids)

    def test_simple_receipt_single_expense(self, auth_session):
        r = auth_session.post(
            f"{BASE_URL}/api/inbox/parse",
            json={"text": SIMPLE_RECEIPT, "source": "paste"},
            timeout=90,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        drafts = r.json()
        ids = [d["id"] for d in drafts]
        try:
            assert isinstance(drafts, list)
            assert len(drafts) == 1, f"expected 1 draft, got {len(drafts)}"
            d = drafts[0]
            assert d["kind"] == "expense", f"expected expense, got {d['kind']}"
            data = d.get("data") or {}
            assert data.get("amount"), f"expense amount missing: {data}"
        finally:
            self._delete(auth_session, ids)

    def test_garbage_returns_single_unknown(self, auth_session):
        r = auth_session.post(
            f"{BASE_URL}/api/inbox/parse",
            json={"text": GARBAGE_TEXT, "source": "paste"},
            timeout=90,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        drafts = r.json()
        ids = [d["id"] for d in drafts]
        try:
            assert isinstance(drafts, list) and len(drafts) == 1
            assert drafts[0]["kind"] == "unknown"
        finally:
            self._delete(auth_session, ids)
