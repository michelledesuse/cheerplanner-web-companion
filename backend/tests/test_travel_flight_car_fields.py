"""Backend tests for the new flight (outbound/return) + car (pickup/dropoff) fields,
and the updated travel CSV template / import flow."""
import io
import os
import uuid
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://dynamic-repaint-v108.preview.emergentagent.com"
).rstrip("/")

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def auth():
    """Sign up a fresh user, return (session, user, comp_id)."""
    email = f"TEST_travelnew_{uuid.uuid4().hex[:10]}@mailinator.com"
    password = "passw0rd!"
    s = requests.Session()
    r = s.post(f"{API}/auth/signup", json={"email": email, "password": password, "name": "Travel Tester"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    # competition for booking
    r = s.post(f"{API}/competitions", json={"name": f"TEST_Comp_{uuid.uuid4().hex[:6]}", "event_date": "2025-11-13", "end_date": "2025-11-15"})
    assert r.status_code == 200, r.text
    comp_id = r.json()["id"]
    return {"session": s, "email": email, "comp_id": comp_id}


# ------------------------- BOOKINGS: FLIGHTS -------------------------
class TestFlightLegCosts:
    def test_post_flight_with_leg_costs_auto_computes_total(self, auth):
        s, comp_id = auth["session"], auth["comp_id"]
        r = s.post(f"{API}/bookings", json={
            "competition_id": comp_id,
            "type": "flight",
            "provider": "Southwest",
            "outbound_cost": 160.50,
            "return_cost": 140.50,
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["outbound_cost"] == 160.50
        assert b["return_cost"] == 140.50
        assert b["cost"] == 301.0  # auto-computed
        # GET back and verify persisted
        gr = s.get(f"{API}/bookings", params={"competition_id": comp_id})
        assert gr.status_code == 200
        got = next((x for x in gr.json() if x["id"] == b["id"]), None)
        assert got is not None and got["cost"] == 301.0

    def test_post_flight_with_explicit_cost_is_not_overwritten(self, auth):
        s, comp_id = auth["session"], auth["comp_id"]
        r = s.post(f"{API}/bookings", json={
            "competition_id": comp_id,
            "type": "flight",
            "cost": 999.99,
            "outbound_cost": 100,
            "return_cost": 200,
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["cost"] == 999.99, "explicit cost must not be overwritten by leg sum"
        assert b["outbound_cost"] == 100
        assert b["return_cost"] == 200

    def test_post_flight_persists_return_airline_confirmation(self, auth):
        s, comp_id = auth["session"], auth["comp_id"]
        r = s.post(f"{API}/bookings", json={
            "competition_id": comp_id,
            "type": "flight",
            "provider": "Delta",
            "confirmation": "OUT123",
            "return_airline": "United",
            "return_confirmation": "RET456",
            "outbound_cost": 175,
            "return_cost": 225,
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["return_airline"] == "United"
        assert b["return_confirmation"] == "RET456"
        assert b["outbound_cost"] == 175
        assert b["return_cost"] == 225
        assert b["cost"] == 400  # auto

    def test_patch_only_outbound_cost_recomputes_total(self, auth):
        s, comp_id = auth["session"], auth["comp_id"]
        r = s.post(f"{API}/bookings", json={
            "competition_id": comp_id,
            "type": "flight",
            "outbound_cost": 100,
            "return_cost": 200,
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        # Update only outbound_cost
        r = s.patch(f"{API}/bookings/{bid}", json={"outbound_cost": 150})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["outbound_cost"] == 150
        assert b["return_cost"] == 200
        assert b["cost"] == 350, f"cost should be recomputed to 350, got {b['cost']}"

    def test_patch_only_return_cost_recomputes_total(self, auth):
        s, comp_id = auth["session"], auth["comp_id"]
        r = s.post(f"{API}/bookings", json={
            "competition_id": comp_id,
            "type": "flight",
            "outbound_cost": 100,
            "return_cost": 200,
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        r = s.patch(f"{API}/bookings/{bid}", json={"return_cost": 250})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["outbound_cost"] == 100
        assert b["return_cost"] == 250
        assert b["cost"] == 350

    def test_patch_flight_null_out_return_fields(self, auth):
        s, comp_id = auth["session"], auth["comp_id"]
        r = s.post(f"{API}/bookings", json={
            "competition_id": comp_id,
            "type": "flight",
            "return_airline": "AA",
            "return_confirmation": "RA999",
            "outbound_cost": 100,
            "return_cost": 100,
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        # Null out return_airline + return_confirmation + return_cost
        r = s.patch(f"{API}/bookings/{bid}", json={
            "return_airline": None,
            "return_confirmation": None,
            "return_cost": None,
            "outbound_cost": None,
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["return_airline"] is None
        assert b["return_confirmation"] is None
        assert b["return_cost"] is None
        assert b["outbound_cost"] is None


# ------------------------- BOOKINGS: CARS -------------------------
class TestCarPickupDropoff:
    def test_post_car_persists_pickup_dropoff(self, auth):
        s, comp_id = auth["session"], auth["comp_id"]
        r = s.post(f"{API}/bookings", json={
            "competition_id": comp_id,
            "type": "car",
            "provider": "Enterprise",
            "confirmation": "ENT789",
            "cost": 180,
            "pickup_at": "2025-11-13 12:30",
            "pickup_location": "Houston Airport",
            "dropoff_at": "2025-11-16 15:00",
            "dropoff_location": "Houston Airport Return",
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["pickup_at"] == "2025-11-13 12:30"
        assert b["pickup_location"] == "Houston Airport"
        assert b["dropoff_at"] == "2025-11-16 15:00"
        assert b["dropoff_location"] == "Houston Airport Return"
        # Verify persistence via GET
        gr = s.get(f"{API}/bookings", params={"competition_id": comp_id})
        got = next((x for x in gr.json() if x["id"] == b["id"]), None)
        assert got is not None
        assert got["pickup_at"] == "2025-11-13 12:30"
        assert got["dropoff_location"] == "Houston Airport Return"

    def test_patch_car_null_out_pickup_dropoff(self, auth):
        s, comp_id = auth["session"], auth["comp_id"]
        r = s.post(f"{API}/bookings", json={
            "competition_id": comp_id,
            "type": "car",
            "pickup_at": "2025-11-13 12:30",
            "pickup_location": "Airport",
            "dropoff_at": "2025-11-16 15:00",
            "dropoff_location": "Airport",
        })
        bid = r.json()["id"]
        r = s.patch(f"{API}/bookings/{bid}", json={
            "pickup_at": None,
            "pickup_location": None,
            "dropoff_at": None,
            "dropoff_location": None,
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["pickup_at"] is None
        assert b["pickup_location"] is None
        assert b["dropoff_at"] is None
        assert b["dropoff_location"] is None


# ------------------------- TEMPLATE -------------------------
class TestTravelTemplate:
    def test_travel_template_includes_new_headers(self, auth):
        s = auth["session"]
        r = s.get(f"{API}/import/template/travel")
        assert r.status_code == 200, r.text
        text = r.text
        header_line = text.splitlines()[0]
        required = [
            "Pickup Date", "Pickup Time", "Pickup Location",
            "Dropoff Date", "Dropoff Time", "Dropoff Location",
            "Outbound Cost", "Return Airline", "Return Confirmation", "Return Cost",
        ]
        for h in required:
            assert h in header_line, f"missing header: {h}"
        # backwards compatibility
        for h in ["Competition", "Hotel Name", "Flight Cost", "Airline"]:
            assert h in header_line


# ------------------------- TRAVEL PREVIEW + COMMIT -------------------------
def _csv_bytes(headers, rows):
    out = io.StringIO()
    out.write(",".join(headers) + "\n")
    for row in rows:
        out.write(",".join(str(x) for x in row) + "\n")
    return out.getvalue().encode("utf-8")


class TestTravelImportNewFields:
    def test_preview_car_row_produces_pickup_dropoff(self, auth):
        s = auth["session"]
        # auth session uses Content-Type json — use a temp session w/o it for file upload
        headers = [h for h in s.headers.items() if h[0].lower() != "content-type"]
        upload_sess = requests.Session()
        upload_sess.headers.update(dict(headers))

        csv = _csv_bytes(
            ["Competition", "Rental Car Company", "Rental Car Confirmation", "Rental Car Cost",
             "Pickup Date", "Pickup Time", "Pickup Location",
             "Dropoff Date", "Dropoff Time", "Dropoff Location"],
            [["TEST_Comp_Import", "Hertz", "HZ123", "200",
              "2025-11-13", "12:30 PM", "DFW Airport",
              "2025-11-16", "3:00 PM", "DFW Return"]],
        )
        r = upload_sess.post(
            f"{API}/import/preview",
            data={"kind": "travel"},
            files={"file": ("travel.csv", csv, "text/csv")},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] == 1
        bookings = data["rows"][0]["bookings"]
        car = next((b for b in bookings if b["type"] == "car"), None)
        assert car is not None, f"no car booking parsed: {bookings}"
        assert car["pickup_at"] == "2025-11-13 12:30"
        assert car["pickup_location"] == "DFW Airport"
        assert car["dropoff_at"] == "2025-11-16 15:00"
        assert car["dropoff_location"] == "DFW Return"

    def test_preview_flight_row_with_outbound_return_costs(self, auth):
        s = auth["session"]
        headers = [h for h in s.headers.items() if h[0].lower() != "content-type"]
        upload_sess = requests.Session()
        upload_sess.headers.update(dict(headers))

        csv = _csv_bytes(
            ["Competition", "Airline", "Flight Confirmation", "Flight Number",
             "Outbound Cost", "Return Airline", "Return Confirmation",
             "Return Flight Number", "Return Cost"],
            [["TEST_Comp_Import_Flt", "Southwest", "OUT-ABC", "WN1",
              "150", "United", "RET-ZZZ", "UA2", "180"]],
        )
        r = upload_sess.post(
            f"{API}/import/preview",
            data={"kind": "travel"},
            files={"file": ("travel.csv", csv, "text/csv")},
        )
        assert r.status_code == 200, r.text
        bookings = r.json()["rows"][0]["bookings"]
        flight = next((b for b in bookings if b["type"] == "flight"), None)
        assert flight is not None
        assert flight["outbound_cost"] == 150
        assert flight["return_airline"] == "United"
        assert flight["return_confirmation"] == "RET-ZZZ"
        assert flight["return_flight_number"] == "UA2"
        assert flight["return_cost"] == 180
        # cost = outbound + return when Flight Cost omitted
        assert flight["cost"] == 330, f"expected 330, got {flight['cost']}"

    def test_commit_persists_new_car_and_flight_fields(self, auth):
        s = auth["session"]
        headers = [h for h in s.headers.items() if h[0].lower() != "content-type"]
        upload_sess = requests.Session()
        upload_sess.headers.update(dict(headers))

        comp_name = f"TEST_ImportFull_{uuid.uuid4().hex[:6]}"
        csv = _csv_bytes(
            ["Competition", "Rental Car Company", "Rental Car Confirmation", "Rental Car Cost",
             "Pickup Date", "Pickup Time", "Pickup Location",
             "Dropoff Date", "Dropoff Time", "Dropoff Location",
             "Airline", "Flight Confirmation", "Flight Number",
             "Outbound Cost", "Return Airline", "Return Confirmation",
             "Return Flight Number", "Return Cost"],
            [[comp_name, "Hertz", "HZ555", "210",
              "2025-12-01", "11:00 AM", "LAX Pickup",
              "2025-12-04", "2:30 PM", "LAX Dropoff",
              "Delta", "DLOUT", "DL10",
              "175", "Alaska", "ASRET", "AS20", "215"]],
        )
        # 1) preview
        r = upload_sess.post(
            f"{API}/import/preview",
            data={"kind": "travel"},
            files={"file": ("travel.csv", csv, "text/csv")},
        )
        assert r.status_code == 200, r.text
        preview = r.json()
        rows = preview["rows"]

        # 2) commit
        r = s.post(f"{API}/import/commit", json={
            "kind": "travel",
            "rows": rows,
            "create_missing_competitions": True,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["created"] >= 2, f"expected at least 2 bookings (car+flight), got {body}"

        # 3) verify persistence via GET /api/bookings
        # find the new competition
        comps = s.get(f"{API}/competitions").json()
        comp = next((c for c in comps if c["name"] == comp_name), None)
        assert comp is not None, "competition should have been created"
        bookings = s.get(f"{API}/bookings", params={"competition_id": comp["id"]}).json()

        car = next((b for b in bookings if b["type"] == "car"), None)
        assert car is not None, f"car booking missing in {bookings}"
        assert car["pickup_at"] == "2025-12-01 11:00", f"car pickup_at not persisted: {car}"
        assert car["pickup_location"] == "LAX Pickup", f"car pickup_location not persisted: {car}"
        assert car["dropoff_at"] == "2025-12-04 14:30", f"car dropoff_at not persisted: {car}"
        assert car["dropoff_location"] == "LAX Dropoff", f"car dropoff_location not persisted: {car}"

        flight = next((b for b in bookings if b["type"] == "flight"), None)
        assert flight is not None, f"flight booking missing in {bookings}"
        assert flight["outbound_cost"] == 175, f"flight outbound_cost not persisted: {flight}"
        assert flight["return_airline"] == "Alaska", f"flight return_airline not persisted: {flight}"
        assert flight["return_confirmation"] == "ASRET", f"flight return_confirmation not persisted: {flight}"
        assert flight["return_cost"] == 215, f"flight return_cost not persisted: {flight}"
        assert flight["cost"] == 390, f"flight total cost should be 175+215=390, got {flight['cost']}"
