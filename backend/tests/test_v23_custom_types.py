"""v2.3 — Custom event types & expense categories (household-wide).

Covers:
- GET /api/household/custom-types (initial + after mutations)
- POST/DELETE /api/household/custom-types/expense-category
- POST/DELETE /api/household/custom-types/event-type
- GET /api/household exposes custom_* fields
- GET /api/calendar returns the chosen custom color for schedule items
- Regression: expense with custom category, schedule with built-in type
"""
import os
import pytest
import requests

BASE_URL = "http://localhost:8001"
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def athlete_id(h):
    r = requests.get(f"{BASE_URL}/api/athletes", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert len(data) > 0
    return data[0]["id"]


# ------------------------------------------------------------------
# Cleanup at module start & module end so applereview stays tidy.
# ------------------------------------------------------------------
def _cleanup(h):
    ct = requests.get(f"{BASE_URL}/api/household/custom-types", headers=h).json()
    for name in ct.get("expense_categories", []):
        requests.delete(
            f"{BASE_URL}/api/household/custom-types/expense-category",
            headers=h,
            json={"name": name},
        )
    for t in ct.get("event_types", []):
        requests.delete(
            f"{BASE_URL}/api/household/custom-types/event-type/{t['id']}",
            headers=h,
        )


@pytest.fixture(scope="module", autouse=True)
def cleanup_around(h):
    _cleanup(h)
    yield
    _cleanup(h)


# ------------------------------------------------------------------
# Expense categories
# ------------------------------------------------------------------
class TestExpenseCategories:
    def test_get_initial_empty(self, h):
        r = requests.get(f"{BASE_URL}/api/household/custom-types", headers=h)
        assert r.status_code == 200
        body = r.json()
        assert body["expense_categories"] == []
        assert body["event_types"] == []

    def test_add_category(self, h):
        r = requests.post(
            f"{BASE_URL}/api/household/custom-types/expense-category",
            headers=h,
            json={"name": "Choreo Deposit"},
        )
        assert r.status_code == 200
        assert "Choreo Deposit" in r.json()["expense_categories"]

    def test_add_duplicate_returns_400(self, h):
        r = requests.post(
            f"{BASE_URL}/api/household/custom-types/expense-category",
            headers=h,
            json={"name": "Choreo Deposit"},
        )
        assert r.status_code == 400

    def test_add_builtin_returns_400(self, h):
        r = requests.post(
            f"{BASE_URL}/api/household/custom-types/expense-category",
            headers=h,
            json={"name": "Tuition"},
        )
        assert r.status_code == 400

    def test_add_empty_returns_400(self, h):
        r = requests.post(
            f"{BASE_URL}/api/household/custom-types/expense-category",
            headers=h,
            json={"name": "   "},
        )
        assert r.status_code == 400

    def test_household_exposes_custom_categories(self, h):
        r = requests.get(f"{BASE_URL}/api/household", headers=h)
        assert r.status_code == 200
        assert "Choreo Deposit" in r.json().get("custom_expense_categories", [])

    def test_expense_with_custom_category(self, h, athlete_id):
        # Regression: create expense using free-string custom category
        payload = {
            "athlete_id": athlete_id,
            "category": "Choreo Deposit",
            "amount": 42.5,
            "incurred_on": "2026-01-15",
        }
        r = requests.post(f"{BASE_URL}/api/expenses", headers=h, json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        # Endpoint may return {id,...} OR the full list (recurrence case)
        if isinstance(body, dict):
            eid = body["id"]
        else:
            match = [e for e in body if e.get("category") == "Choreo Deposit" and e.get("amount") == 42.5]
            assert match, "created expense not in response list"
            eid = match[0]["id"]
        # GET verifies persistence
        lst = requests.get(f"{BASE_URL}/api/expenses", headers=h).json()
        match = [e for e in lst if e["id"] == eid]
        assert match and match[0]["category"] == "Choreo Deposit"
        # Cleanup
        requests.delete(f"{BASE_URL}/api/expenses/{eid}", headers=h)

    def test_delete_category(self, h):
        r = requests.delete(
            f"{BASE_URL}/api/household/custom-types/expense-category",
            headers=h,
            json={"name": "Choreo Deposit"},
        )
        assert r.status_code == 200
        assert "Choreo Deposit" not in r.json()["expense_categories"]


# ------------------------------------------------------------------
# Event types (with color)
# ------------------------------------------------------------------
class TestEventTypes:
    _saved: dict = {}

    def test_add_event_type(self, h):
        r = requests.post(
            f"{BASE_URL}/api/household/custom-types/event-type",
            headers=h,
            json={"label": "Tumbling", "color": "#F59E0B"},
        )
        assert r.status_code == 200
        body = r.json()
        et = body["event_type"]
        assert et["label"] == "Tumbling"
        assert et["color"] == "#F59E0B"
        assert et["id"].startswith("custom_tumbling_")
        assert any(t["id"] == et["id"] for t in body["event_types"])
        TestEventTypes._saved["id"] = et["id"]

    def test_household_exposes_custom_event_types(self, h):
        r = requests.get(f"{BASE_URL}/api/household", headers=h)
        assert r.status_code == 200
        types = r.json().get("custom_event_types", [])
        assert any(t.get("label") == "Tumbling" for t in types)

    def test_add_empty_label_400(self, h):
        r = requests.post(
            f"{BASE_URL}/api/household/custom-types/event-type",
            headers=h,
            json={"label": "", "color": "#0EA5E9"},
        )
        assert r.status_code == 400

    def test_calendar_uses_custom_color(self, h, athlete_id):
        et_id = TestEventTypes._saved["id"]
        # Create schedule event with custom type id
        payload = {
            "athlete_ids": [athlete_id],
            "event_type": et_id,
            "title": "TEST_Tumbling_Session",
            "date": "2026-02-10",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", headers=h, json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        if isinstance(body, dict):
            sid = body["id"]
        else:
            match = [e for e in body if e.get("title") == "TEST_Tumbling_Session"]
            assert match
            sid = match[0]["id"]
        # GET calendar for that day
        cal = requests.get(
            f"{BASE_URL}/api/calendar",
            headers=h,
            params={"start": "2026-02-01", "end": "2026-02-28"},
        )
        assert cal.status_code == 200
        items = [i for i in cal.json()["items"] if i.get("id", "").startswith(f"schedule-{sid}")]
        assert items, "schedule item missing from calendar"
        assert items[0]["color"] == "#F59E0B", f"expected custom color, got {items[0]['color']}"
        # Cleanup schedule
        requests.delete(f"{BASE_URL}/api/schedule/{sid}?scope=single", headers=h)

    def test_schedule_builtin_type_still_works(self, h, athlete_id):
        payload = {
            "athlete_ids": [athlete_id],
            "event_type": "practice",
            "title": "TEST_Practice_Regression",
            "date": "2026-02-11",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", headers=h, json=payload)
        assert r.status_code == 200
        body = r.json()
        if isinstance(body, dict):
            sid = body["id"]
        else:
            match = [e for e in body if e.get("title") == "TEST_Practice_Regression"]
            assert match
            sid = match[0]["id"]
        cal = requests.get(
            f"{BASE_URL}/api/calendar",
            headers=h,
            params={"start": "2026-02-01", "end": "2026-02-28"},
        ).json()
        items = [i for i in cal["items"] if i.get("id", "").startswith(f"schedule-{sid}")]
        assert items and items[0]["color"] == "#EA580C"
        requests.delete(f"{BASE_URL}/api/schedule/{sid}?scope=single", headers=h)

    def test_delete_event_type(self, h):
        et_id = TestEventTypes._saved["id"]
        r = requests.delete(
            f"{BASE_URL}/api/household/custom-types/event-type/{et_id}",
            headers=h,
        )
        assert r.status_code == 200
        assert not any(t["id"] == et_id for t in r.json()["event_types"])
