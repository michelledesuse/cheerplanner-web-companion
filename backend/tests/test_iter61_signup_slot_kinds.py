"""Tests for Team Hub — Sign-Up Slot kind + time_label (iteration 61).

Focused on new slot 'kind' selector (item/duty/time) and optional time_label:
- POST /api/team/signups/{id}/slots correctly stores kind (default 'item') and time_label
- PATCH /api/team/signups/{id}/slots/{slot_id} can update kind and time_label
- GET /api/team/signups/{id} persists both fields (Create->GET, Update->GET verify)
- Invalid kind is rejected (422)
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
).rstrip("/")

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def sheet_id(api_client):
    name = f"TEST_KindSheet_{uuid.uuid4().hex[:6]}"
    r = api_client.post(f"{BASE_URL}/api/team/signups", json={"name": name})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    yield sid
    api_client.delete(f"{BASE_URL}/api/team/signups/{sid}")


class TestSlotKinds:
    def test_add_item_slot_defaults_kind_item(self, api_client, sheet_id):
        r = api_client.post(
            f"{BASE_URL}/api/team/signups/{sheet_id}/slots",
            json={"label": "TEST_Water bottles", "qty_needed": 4},
        )
        assert r.status_code == 200, r.text
        slots = r.json()["slots"]
        slot = next(s for s in slots if s["label"] == "TEST_Water bottles")
        assert slot["kind"] == "item"
        assert slot.get("time_label") in (None, "")

    def test_add_duty_slot(self, api_client, sheet_id):
        r = api_client.post(
            f"{BASE_URL}/api/team/signups/{sheet_id}/slots",
            json={"label": "TEST_Chaperone", "qty_needed": 2, "kind": "duty"},
        )
        assert r.status_code == 200, r.text
        slot = next(s for s in r.json()["slots"] if s["label"] == "TEST_Chaperone")
        assert slot["kind"] == "duty"
        assert slot.get("time_label") in (None, "")

    def test_add_time_slot_with_time_label(self, api_client, sheet_id):
        r = api_client.post(
            f"{BASE_URL}/api/team/signups/{sheet_id}/slots",
            json={
                "label": "TEST_Front desk",
                "qty_needed": 1,
                "kind": "time",
                "time_label": "Sat 2:00\u20134:00 PM",
            },
        )
        assert r.status_code == 200, r.text
        slot = next(s for s in r.json()["slots"] if s["label"] == "TEST_Front desk")
        assert slot["kind"] == "time"
        assert slot["time_label"] == "Sat 2:00\u20134:00 PM"

    def test_get_persists_kind_and_time_label(self, api_client, sheet_id):
        r = api_client.get(f"{BASE_URL}/api/team/signups/{sheet_id}")
        assert r.status_code == 200, r.text
        slots = {s["label"]: s for s in r.json()["slots"]}
        assert slots["TEST_Water bottles"]["kind"] == "item"
        assert slots["TEST_Chaperone"]["kind"] == "duty"
        assert slots["TEST_Front desk"]["kind"] == "time"
        assert slots["TEST_Front desk"]["time_label"] == "Sat 2:00\u20134:00 PM"

    def test_patch_slot_change_kind_and_time_label(self, api_client, sheet_id):
        # Get current slots
        doc = api_client.get(f"{BASE_URL}/api/team/signups/{sheet_id}").json()
        target = next(s for s in doc["slots"] if s["label"] == "TEST_Water bottles")
        slot_id = target["id"]
        r = api_client.patch(
            f"{BASE_URL}/api/team/signups/{sheet_id}/slots/{slot_id}",
            json={"kind": "time", "time_label": "Fri 6\u20138 PM"},
        )
        assert r.status_code == 200, r.text
        # GET to verify persisted
        r2 = api_client.get(f"{BASE_URL}/api/team/signups/{sheet_id}")
        updated = next(s for s in r2.json()["slots"] if s["id"] == slot_id)
        assert updated["kind"] == "time"
        assert updated["time_label"] == "Fri 6\u20138 PM"

    def test_patch_clear_time_label(self, api_client, sheet_id):
        doc = api_client.get(f"{BASE_URL}/api/team/signups/{sheet_id}").json()
        target = next(s for s in doc["slots"] if s["label"] == "TEST_Front desk")
        slot_id = target["id"]
        # Empty string should clear time_label to None
        r = api_client.patch(
            f"{BASE_URL}/api/team/signups/{sheet_id}/slots/{slot_id}",
            json={"kind": "duty", "time_label": ""},
        )
        assert r.status_code == 200, r.text
        r2 = api_client.get(f"{BASE_URL}/api/team/signups/{sheet_id}")
        updated = next(s for s in r2.json()["slots"] if s["id"] == slot_id)
        assert updated["kind"] == "duty"
        assert updated.get("time_label") in (None, "")

    def test_invalid_kind_rejected(self, api_client, sheet_id):
        r = api_client.post(
            f"{BASE_URL}/api/team/signups/{sheet_id}/slots",
            json={"label": "TEST_Invalid", "qty_needed": 1, "kind": "bogus"},
        )
        # Pydantic Literal enforcement -> 422
        assert r.status_code in (400, 422), f"Expected 4xx, got {r.status_code}: {r.text}"
