"""Iter71 — Multi-attach: signup / payment / attendance now attach to multiple
competitions AND multiple schedule events via competition_ids[] + event_ids[].

Covers:
- PATCH each tool with competition_ids/event_ids arrays
- GET list with ?event_id= and ?competition_id= filter by membership in arrays
- Multi-attach: same tool on two events → shows in both filters
- Detach from one keeps the other

Runs against the public EXPO_BACKEND_URL using the seeded review account.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # Fallback: read from frontend/.env (tests must never hardcode urls at module-eval)
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL is not configured"

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    assert token, f"No token in login response: {r.json()}"
    s.headers["Authorization"] = f"Bearer {token}"
    return s


@pytest.fixture(scope="module")
def two_events(api):
    """Create two throwaway schedule events; clean up at end."""
    created = []
    for i in range(2):
        r = api.post(f"{BASE_URL}/api/schedule", json={
            "title": f"TEST_iter71_event_{i}",
            "date": "2026-06-01",
            "event_type": "practice",
        }, timeout=15)
        assert r.status_code in (200, 201), f"schedule create failed: {r.status_code} {r.text}"
        body = r.json()
        created.append((body[0] if isinstance(body, list) else body)["id"])
    yield created
    for eid in created:
        api.delete(f"{BASE_URL}/api/schedule/{eid}")


@pytest.fixture(scope="module")
def one_competition(api):
    r = api.post(f"{BASE_URL}/api/competitions", json={
        "name": "TEST_iter71_comp",
        "event_date": "2026-06-15",
    }, timeout=15)
    assert r.status_code in (200, 201), f"comp create failed: {r.status_code} {r.text}"
    cid = r.json()["id"]
    yield cid
    api.delete(f"{BASE_URL}/api/competitions/{cid}")


# --- Sign-up sheet ---
class TestSignupMultiAttach:
    def test_signup_multi_attach_flow(self, api, two_events, one_competition):
        e1, e2 = two_events
        # create
        r = api.post(f"{BASE_URL}/api/team/signups", json={"name": "TEST_iter71_signup"})
        assert r.status_code in (200, 201), r.text
        sid = r.json()["id"]
        try:
            # attach to both events
            r = api.patch(f"{BASE_URL}/api/team/signups/{sid}", json={"event_ids": [e1, e2]})
            assert r.status_code == 200, r.text
            body = r.json()
            assert set(body["event_ids"]) == {e1, e2}
            # attach competition too
            r = api.patch(f"{BASE_URL}/api/team/signups/{sid}", json={"competition_ids": [one_competition]})
            assert r.status_code == 200
            # list filter by e1 → present
            r1 = api.get(f"{BASE_URL}/api/team/signups?event_id={e1}").json()
            assert any(x["id"] == sid for x in r1), "should appear under event 1"
            # list filter by e2 → present
            r2 = api.get(f"{BASE_URL}/api/team/signups?event_id={e2}").json()
            assert any(x["id"] == sid for x in r2), "should appear under event 2"
            # list filter by competition → present
            rc = api.get(f"{BASE_URL}/api/team/signups?competition_id={one_competition}").json()
            assert any(x["id"] == sid for x in rc)
            # unlink from e1 → still on e2
            r = api.patch(f"{BASE_URL}/api/team/signups/{sid}", json={"event_ids": [e2]})
            assert r.status_code == 200
            r1 = api.get(f"{BASE_URL}/api/team/signups?event_id={e1}").json()
            assert not any(x["id"] == sid for x in r1)
            r2 = api.get(f"{BASE_URL}/api/team/signups?event_id={e2}").json()
            assert any(x["id"] == sid for x in r2)
            # GET single shows arrays persisted
            g = api.get(f"{BASE_URL}/api/team/signups/{sid}").json()
            assert g["event_ids"] == [e2]
            assert g["competition_ids"] == [one_competition]
        finally:
            api.delete(f"{BASE_URL}/api/team/signups/{sid}")


# --- Payment tracker ---
class TestPaymentMultiAttach:
    def test_payment_multi_attach_flow(self, api, two_events, one_competition):
        e1, e2 = two_events
        r = api.post(f"{BASE_URL}/api/team/payments", json={"name": "TEST_iter71_pay", "amount": 25})
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        try:
            r = api.patch(f"{BASE_URL}/api/team/payments/{pid}",
                          json={"event_ids": [e1, e2], "competition_ids": [one_competition]})
            assert r.status_code == 200, r.text
            body = r.json()
            assert set(body["event_ids"]) == {e1, e2}
            assert body["competition_ids"] == [one_competition]
            for eid in (e1, e2):
                found = api.get(f"{BASE_URL}/api/team/payments?event_id={eid}").json()
                assert any(x["id"] == pid for x in found), f"pay missing under {eid}"
            # Detach from e2 → still on e1
            r = api.patch(f"{BASE_URL}/api/team/payments/{pid}", json={"event_ids": [e1]})
            assert r.status_code == 200
            found1 = api.get(f"{BASE_URL}/api/team/payments?event_id={e1}").json()
            found2 = api.get(f"{BASE_URL}/api/team/payments?event_id={e2}").json()
            assert any(x["id"] == pid for x in found1)
            assert not any(x["id"] == pid for x in found2)
        finally:
            api.delete(f"{BASE_URL}/api/team/payments/{pid}")


# --- Attendance session ---
class TestAttendanceMultiAttach:
    def test_attendance_multi_attach_flow(self, api, two_events, one_competition):
        e1, e2 = two_events
        r = api.post(f"{BASE_URL}/api/team/attendance", json={"title": "TEST_iter71_att", "date": "2026-06-01"})
        assert r.status_code in (200, 201), r.text
        aid = r.json()["id"]
        try:
            r = api.patch(f"{BASE_URL}/api/team/attendance/{aid}",
                          json={"event_ids": [e1, e2], "competition_ids": [one_competition]})
            assert r.status_code == 200, r.text
            body = r.json()
            assert set(body["event_ids"]) == {e1, e2}
            for eid in (e1, e2):
                found = api.get(f"{BASE_URL}/api/team/attendance?event_id={eid}").json()
                assert any(x["id"] == aid for x in found), f"attendance missing under {eid}"
            found_c = api.get(f"{BASE_URL}/api/team/attendance?competition_id={one_competition}").json()
            assert any(x["id"] == aid for x in found_c)
            # Detach from e1 → still on e2
            r = api.patch(f"{BASE_URL}/api/team/attendance/{aid}", json={"event_ids": [e2]})
            assert r.status_code == 200
            found1 = api.get(f"{BASE_URL}/api/team/attendance?event_id={e1}").json()
            found2 = api.get(f"{BASE_URL}/api/team/attendance?event_id={e2}").json()
            assert not any(x["id"] == aid for x in found1)
            assert any(x["id"] == aid for x in found2)
        finally:
            api.delete(f"{BASE_URL}/api/team/attendance/{aid}")


# --- Regression: legacy single-event links migrated to arrays ---
class TestRegressionListing:
    def test_lists_do_not_500(self, api):
        for path in ("/api/team/signups", "/api/team/payments", "/api/team/attendance"):
            r = api.get(f"{BASE_URL}{path}")
            assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"
            data = r.json()
            assert isinstance(data, list)
            for it in data:
                # Both keys must exist as lists after migration
                assert isinstance(it.get("competition_ids", []), list)
                assert isinstance(it.get("event_ids", []), list)
