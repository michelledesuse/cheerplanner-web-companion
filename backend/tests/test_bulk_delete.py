"""Tests for POST /api/bulk-delete generic endpoint.

Covers:
- Resource happy path (all supported collections + 'schedules' alias)
- Empty ids → {deleted: 0}
- Unsupported resource → 400
- Auth required (no token → 401/403)
- Household scoping: co-parent can delete the other parent's records
- Cross-household isolation: ids belonging to a different household → deleted: 0
- After deletion records are gone via GET /api/{resource}
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

PRIMARY_EMAIL = "smoke@test.com"
PRIMARY_PASS = "password123"


# ------------------------------ helpers ------------------------------
def _signup_or_login(email: str, password: str, name: str = "Tester") -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json()["access_token"]
    r2 = requests.post(f"{API}/auth/signup", json={"email": email, "password": password, "name": name})
    assert r2.status_code == 200, f"signup failed: {r2.status_code} {r2.text}"
    return r2.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _create_athlete(token: str, name: str = "TEST_BulkAth") -> str:
    r = requests.post(f"{API}/athletes", json={"name": name}, headers=_headers(token))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_expense(token: str, athlete_id: str) -> str:
    r = requests.post(
        f"{API}/expenses",
        json={
            "athlete_id": athlete_id,
            "category": "Misc",
            "amount": 10.0,
            "incurred_on": "2026-01-15",
            "note": "TEST_bulk_delete",
        },
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


def _create_payment(token: str, athlete_id: str) -> str:
    r = requests.post(
        f"{API}/payments",
        json={"athlete_id": athlete_id, "amount": 5.0, "paid_on": "2026-01-15", "note": "TEST_bulk"},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_competition(token: str) -> str:
    r = requests.post(
        f"{API}/competitions",
        json={"name": f"TEST_Comp_{uuid.uuid4().hex[:6]}", "event_date": "2026-03-01"},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_booking(token: str, comp_id: str) -> str:
    r = requests.post(
        f"{API}/bookings",
        json={"competition_id": comp_id, "type": "hotel", "provider": "TEST_Hotel", "cost": 100.0},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_fundraiser(token: str) -> str:
    r = requests.post(
        f"{API}/fundraisers",
        json={"name": "TEST_Fund", "amount_raised": 50.0, "raised_on": "2026-01-15"},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_schedule(token: str) -> str:
    r = requests.post(
        f"{API}/schedule",
        json={"title": "TEST_Practice", "date": "2026-01-20", "event_type": "practice"},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


def _create_packing_template(token: str) -> str:
    r = requests.post(
        f"{API}/packing-templates",
        json={"name": f"TEST_Tpl_{uuid.uuid4().hex[:6]}", "items": [], "tips": []},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_packing_list(token: str, comp_id: str) -> str:
    r = requests.post(
        f"{API}/competitions/{comp_id}/packing-list",
        json={"competition_id": comp_id, "name": "TEST_PL"},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ------------------------------ fixtures ------------------------------
@pytest.fixture(scope="module")
def primary_token() -> str:
    return _signup_or_login(PRIMARY_EMAIL, PRIMARY_PASS, "Smoke Test")


@pytest.fixture(scope="module")
def primary_athlete(primary_token) -> str:
    return _create_athlete(primary_token, "TEST_BulkDelPrimary")


# ------------------------------ tests ------------------------------
class TestBulkDeleteAuth:
    def test_requires_auth(self):
        r = requests.post(f"{API}/bulk-delete", json={"resource": "expenses", "ids": []})
        # HTTPBearer with auto_error=False + explicit 401 in get_current_user
        assert r.status_code in (401, 403), f"got {r.status_code}: {r.text}"


class TestBulkDeleteValidation:
    def test_unsupported_resource_returns_400(self, primary_token):
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "foo", "ids": ["x"]},
            headers=_headers(primary_token),
        )
        assert r.status_code == 400, r.text
        body = r.json()
        assert "Unsupported resource" in body.get("detail", "")

    def test_empty_ids_returns_zero(self, primary_token):
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "expenses", "ids": []},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"deleted": 0}


class TestBulkDeleteExpensesHappy:
    def test_delete_multiple_expenses(self, primary_token, primary_athlete):
        ids = [_create_expense(primary_token, primary_athlete) for _ in range(3)]
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "expenses", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deleted"] == 3
        assert body["resource"] == "expenses"
        # Verify gone via GET
        list_r = requests.get(f"{API}/expenses", headers=_headers(primary_token))
        assert list_r.status_code == 200
        remaining_ids = {e["id"] for e in list_r.json()}
        assert not (set(ids) & remaining_ids)


class TestBulkDeleteAllResources:
    """Verify deletion works for every supported resource (incl. schedules alias)."""

    def test_payments(self, primary_token, primary_athlete):
        ids = [_create_payment(primary_token, primary_athlete) for _ in range(2)]
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "payments", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200 and r.json()["deleted"] == 2, r.text
        remaining = {p["id"] for p in requests.get(f"{API}/payments", headers=_headers(primary_token)).json()}
        assert not (set(ids) & remaining)

    def test_fundraisers(self, primary_token):
        ids = [_create_fundraiser(primary_token) for _ in range(2)]
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "fundraisers", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200 and r.json()["deleted"] == 2, r.text
        remaining = {f["id"] for f in requests.get(f"{API}/fundraisers", headers=_headers(primary_token)).json()}
        assert not (set(ids) & remaining)

    def test_competitions(self, primary_token):
        ids = [_create_competition(primary_token) for _ in range(2)]
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "competitions", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200 and r.json()["deleted"] == 2, r.text
        remaining = {c["id"] for c in requests.get(f"{API}/competitions", headers=_headers(primary_token)).json()}
        assert not (set(ids) & remaining)

    def test_bookings(self, primary_token):
        comp_id = _create_competition(primary_token)
        ids = [_create_booking(primary_token, comp_id) for _ in range(2)]
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "bookings", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200 and r.json()["deleted"] == 2, r.text
        remaining = {b["id"] for b in requests.get(f"{API}/bookings", headers=_headers(primary_token)).json()}
        assert not (set(ids) & remaining)

    def test_schedules_alias(self, primary_token):
        """`schedules` should map to schedule_events collection."""
        ids = [_create_schedule(primary_token) for _ in range(2)]
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "schedules", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == 2
        remaining = {e["id"] for e in requests.get(f"{API}/schedule", headers=_headers(primary_token)).json()}
        assert not (set(ids) & remaining)

    def test_schedule_events_canonical(self, primary_token):
        ids = [_create_schedule(primary_token) for _ in range(2)]
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "schedule_events", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200 and r.json()["deleted"] == 2, r.text

    def test_packing_templates(self, primary_token):
        ids = [_create_packing_template(primary_token) for _ in range(2)]
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "packing_templates", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200 and r.json()["deleted"] == 2, r.text
        remaining = {t["id"] for t in requests.get(f"{API}/packing-templates", headers=_headers(primary_token)).json()}
        assert not (set(ids) & remaining)

    def test_packing_lists(self, primary_token):
        # 2 separate competitions because /competitions/{id}/packing-list is upsert (one per comp)
        ids = []
        for _ in range(2):
            comp = _create_competition(primary_token)
            ids.append(_create_packing_list(primary_token, comp))
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "packing_lists", "ids": ids},
            headers=_headers(primary_token),
        )
        assert r.status_code == 200 and r.json()["deleted"] == 2, r.text


class TestBulkDeleteHouseholdScope:
    """Co-parents should be able to delete each other's records; foreign household ids should not delete."""

    def test_coparent_can_delete_other_parent_records(self):
        # Parent A
        a_email = f"TEST_bulkA_{uuid.uuid4().hex[:8]}@test.com"
        b_email = f"TEST_bulkB_{uuid.uuid4().hex[:8]}@test.com"
        token_a = _signup_or_login(a_email, "passw0rd123", "Parent A")
        token_b = _signup_or_login(b_email, "passw0rd123", "Parent B")

        # A creates invite, B joins → same household
        inv = requests.post(f"{API}/household/invite", headers=_headers(token_a))
        assert inv.status_code == 200, inv.text
        code = inv.json()["code"]
        join = requests.post(f"{API}/household/join", json={"code": code}, headers=_headers(token_b))
        assert join.status_code == 200, join.text

        # A creates an athlete + expense
        ath = _create_athlete(token_a, "TEST_BulkScope")
        exp_id_owned_by_a = _create_expense(token_a, ath)

        # B (co-parent) deletes A's expense via bulk-delete
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "expenses", "ids": [exp_id_owned_by_a]},
            headers=_headers(token_b),
        )
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == 1
        # Verify gone from A's perspective
        lst = requests.get(f"{API}/expenses", headers=_headers(token_a)).json()
        assert exp_id_owned_by_a not in {e["id"] for e in lst}

    def test_cross_household_isolation(self, primary_token, primary_athlete):
        # Outsider user — totally separate household
        outsider_email = f"TEST_bulkOut_{uuid.uuid4().hex[:8]}@test.com"
        out_token = _signup_or_login(outsider_email, "passw0rd123", "Outsider")

        # Create an expense in primary household
        exp_id = _create_expense(primary_token, primary_athlete)

        # Outsider attempts to bulk-delete it
        r = requests.post(
            f"{API}/bulk-delete",
            json={"resource": "expenses", "ids": [exp_id]},
            headers=_headers(out_token),
        )
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == 0, f"cross-household leak! deleted={r.json()}"

        # Confirm expense still exists in primary
        lst = requests.get(f"{API}/expenses", headers=_headers(primary_token)).json()
        assert exp_id in {e["id"] for e in lst}

        # Clean up
        requests.post(
            f"{API}/bulk-delete",
            json={"resource": "expenses", "ids": [exp_id]},
            headers=_headers(primary_token),
        )
