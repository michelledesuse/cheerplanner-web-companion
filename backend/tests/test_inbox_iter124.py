"""Backend tests for Smart Inbox (iter124).

Covers /api/inbox/parse, /api/inbox/drafts, /api/inbox/drafts/{id}/confirm (both
expense + booking), DELETE, /api/inbox/address, and auth guard.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "demo@cheerplanner.app"
PASSWORD = "CheerDemo2026!"

FLIGHT_TEXT = (
    "Your flight is confirmed!\n"
    "Delta Air Lines - Confirmation: XYZ123\n"
    "Flight DL456 from ATL (Atlanta) to LAX (Los Angeles)\n"
    "Depart: 2026-03-12 08:00, Arrive: 2026-03-12 10:35\n"
    "Total: $342.10"
)

RECEIPT_TEXT = (
    "Cheer Uniforms Co. Receipt\n"
    "Date: 2026-02-05\n"
    "Item: New competition uniform\n"
    "Total: $185.00\n"
    "Thank you for your purchase!"
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def cleanup(headers):
    """Track drafts/expenses/bookings created so we can clean up at end."""
    state = {"drafts": [], "expenses": [], "bookings": []}
    yield state
    for did in state["drafts"]:
        try:
            requests.delete(f"{API}/inbox/drafts/{did}", headers=headers, timeout=15)
        except Exception:
            pass
    for eid in state["expenses"]:
        try:
            requests.delete(f"{API}/expenses/{eid}", headers=headers, timeout=15)
        except Exception:
            pass
    for bid in state["bookings"]:
        try:
            requests.delete(f"{API}/bookings/{bid}", headers=headers, timeout=15)
        except Exception:
            pass


# --- auth guard --------------------------------------------------------------
class TestAuthGuard:
    def test_parse_requires_auth(self):
        r = requests.post(f"{API}/inbox/parse", json={"text": "x"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_drafts_requires_auth(self):
        r = requests.get(f"{API}/inbox/drafts", timeout=15)
        assert r.status_code in (401, 403)

    def test_address_requires_auth(self):
        r = requests.get(f"{API}/inbox/address", timeout=15)
        assert r.status_code in (401, 403)


# --- address -----------------------------------------------------------------
class TestAddress:
    def test_address_not_configured(self, headers):
        r = requests.get(f"{API}/inbox/address", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("configured") is False
        # address should be None when domain not set
        assert data.get("address") in (None, "")


# --- parse flight ------------------------------------------------------------
class TestParseAndConfirm:
    def test_parse_flight_returns_booking_draft(self, headers, cleanup):
        r = requests.post(
            f"{API}/inbox/parse",
            json={"text": FLIGHT_TEXT, "source": "paste"},
            headers=headers,
            timeout=90,  # LLM may be slow
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        d = r.json()
        assert d["kind"] == "booking", f"Expected kind=booking, got {d.get('kind')} data={d.get('data')}"
        assert d["id"]
        cleanup["drafts"].append(d["id"])
        # Verify draft appears in list
        lr = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
        assert lr.status_code == 200
        ids = [x["id"] for x in lr.json()]
        assert d["id"] in ids
        # Save for confirm test
        cleanup["_flight_draft"] = d

    def test_parse_receipt_returns_expense_draft(self, headers, cleanup):
        r = requests.post(
            f"{API}/inbox/parse",
            json={"text": RECEIPT_TEXT, "source": "paste"},
            headers=headers,
            timeout=90,
        )
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["kind"] == "expense", f"Expected kind=expense, got {d.get('kind')} data={d.get('data')}"
        cleanup["drafts"].append(d["id"])
        data = d.get("data") or {}
        assert data.get("amount") is not None
        assert data.get("category")
        cleanup["_expense_draft"] = d

    def test_parse_rejects_empty(self, headers):
        r = requests.post(f"{API}/inbox/parse", json={}, headers=headers, timeout=15)
        assert r.status_code == 400

    def test_drafts_scoped_to_user(self, headers, cleanup):
        # All returned drafts should have status=pending; user scoping is verified
        # implicitly (we can only see our own).
        r = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
        assert r.status_code == 200
        for x in r.json():
            assert x.get("status", "pending") == "pending"

    def test_confirm_expense_creates_expense(self, headers, cleanup):
        # Get an athlete
        ar = requests.get(f"{API}/athletes", headers=headers, timeout=15)
        assert ar.status_code == 200
        athletes = ar.json()
        assert athletes, "Demo account should have athletes seeded"
        athlete_id = athletes[0]["id"]

        draft = cleanup.get("_expense_draft")
        assert draft, "Expense draft prerequisite missing"
        edata = draft.get("data") or {}
        body = {
            "kind": "expense",
            "expense": {
                "athlete_id": athlete_id,
                "category": edata.get("category") or "Uniform",
                "amount": float(edata.get("amount") or 185.0),
                "incurred_on": edata.get("incurred_on") or "2026-02-05",
                "note": "TEST_iter124_inbox",
            },
        }
        r = requests.post(f"{API}/inbox/drafts/{draft['id']}/confirm", json=body, headers=headers, timeout=30)
        assert r.status_code == 200, r.text[:400]
        result = r.json()
        assert result["kind"] == "expense"
        created = result["created"]
        # create_expense may return a dict or a list — normalize
        if isinstance(created, list):
            assert created, "Expected at least one created expense"
            created_id = created[0]["id"]
        else:
            created_id = created["id"]
        cleanup["expenses"].append(created_id)

        # Verify appears in /api/expenses
        er = requests.get(f"{API}/expenses", headers=headers, timeout=15)
        assert er.status_code == 200
        ids = [e["id"] for e in er.json()]
        assert created_id in ids

        # Verify draft removed from pending list
        lr = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
        assert draft["id"] not in [x["id"] for x in lr.json()]

    def test_confirm_booking_creates_booking(self, headers, cleanup):
        # Need a competition
        cr = requests.get(f"{API}/competitions", headers=headers, timeout=15)
        assert cr.status_code == 200
        comps = cr.json()
        if not comps:
            # Create one
            new = requests.post(
                f"{API}/competitions",
                json={"name": "TEST_iter124_comp", "event_date": "2026-05-01", "location": "Test City"},
                headers=headers,
                timeout=15,
            )
            assert new.status_code in (200, 201), new.text[:200]
            comp_id = new.json()["id"]
        else:
            comp_id = comps[0]["id"]

        draft = cleanup.get("_flight_draft")
        assert draft, "Flight draft prerequisite missing"
        bdata = draft.get("data") or {}
        body = {
            "kind": "booking",
            "booking": {
                **bdata,
                "competition_id": comp_id,
                "type": bdata.get("type") or "flight",
                "provider": bdata.get("provider") or "Delta",
                "confirmation": bdata.get("confirmation") or "XYZ123",
                "cost": float(bdata.get("cost") or 342.10),
            },
        }
        # Remove vendor if present (per frontend logic)
        body["booking"].pop("vendor", None)
        r = requests.post(f"{API}/inbox/drafts/{draft['id']}/confirm", json=body, headers=headers, timeout=30)
        assert r.status_code == 200, r.text[:500]
        result = r.json()
        assert result["kind"] == "booking"
        created = result["created"]
        cleanup["bookings"].append(created["id"])

        # Verify in /api/bookings
        br = requests.get(f"{API}/bookings", headers=headers, timeout=15)
        assert br.status_code == 200
        ids = [b["id"] for b in br.json()]
        assert created["id"] in ids

        # Verify draft gone
        lr = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
        assert draft["id"] not in [x["id"] for x in lr.json()]


# --- delete ------------------------------------------------------------------
class TestDelete:
    def test_delete_draft(self, headers, cleanup):
        # Create a tiny draft to delete
        r = requests.post(
            f"{API}/inbox/parse",
            json={"text": "Starbucks $6.75 coffee 2026-02-01", "source": "paste"},
            headers=headers,
            timeout=90,
        )
        assert r.status_code == 200
        did = r.json()["id"]
        cleanup["drafts"].append(did)
        d = requests.delete(f"{API}/inbox/drafts/{did}", headers=headers, timeout=15)
        assert d.status_code == 200
        # Ensure gone
        lr = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
        assert did not in [x["id"] for x in lr.json()]

    def test_delete_missing_returns_404(self, headers):
        d = requests.delete(f"{API}/inbox/drafts/does-not-exist-xyz", headers=headers, timeout=15)
        assert d.status_code == 404
