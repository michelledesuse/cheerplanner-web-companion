"""Backend tests for CheerPlanner v2.2:
- Feature #4: Multi-day schedule events (end_date persistence + calendar expansion)
- Feature #6: Shareable fundraiser links (share endpoint + public GET)
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# -------- Multi-day schedule --------
class TestMultiDaySchedule:
    def test_create_with_end_date_persists(self, auth):
        payload = {
            "title": f"TEST_multiday_{uuid.uuid4().hex[:6]}",
            "event_type": "choreography",
            "date": "2026-07-01",
            "end_date": "2026-07-05",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list) and len(arr) == 1
        ev = arr[0]
        assert ev["end_date"] == "2026-07-05"
        assert ev["date"] == "2026-07-01"
        # cleanup
        requests.delete(f"{BASE_URL}/api/schedule/{ev['id']}", headers=auth, timeout=30)

    def test_get_schedule_returns_end_date(self, auth):
        payload = {
            "title": f"TEST_multiday_get_{uuid.uuid4().hex[:6]}",
            "date": "2026-07-10",
            "end_date": "2026-07-12",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200
        eid = r.json()[0]["id"]
        try:
            g = requests.get(f"{BASE_URL}/api/schedule", headers=auth, timeout=30)
            assert g.status_code == 200
            match = next((e for e in g.json() if e["id"] == eid), None)
            assert match is not None
            assert match["end_date"] == "2026-07-12"
        finally:
            requests.delete(f"{BASE_URL}/api/schedule/{eid}", headers=auth, timeout=30)

    def test_calendar_expands_multiday_across_range(self, auth):
        payload = {
            "title": f"TEST_choreo_{uuid.uuid4().hex[:6]}",
            "event_type": "choreography",
            "date": "2026-07-01",
            "end_date": "2026-07-05",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200
        eid = r.json()[0]["id"]
        title = payload["title"]
        try:
            c = requests.get(
                f"{BASE_URL}/api/calendar",
                params={"start": "2026-07-01", "end": "2026-07-31"},
                headers=auth,
                timeout=30,
            )
            assert c.status_code == 200
            items = c.json()["items"]
            sched = [i for i in items if i["kind"] == "schedule" and i["title"].startswith(title)]
            assert len(sched) == 5, f"expected 5 days got {len(sched)}: {[s['title'] for s in sched]}"
            # verify day suffix
            days = sorted(s["date"] for s in sched)
            assert days == ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]
            # each title contains 'day N/5'
            for s in sched:
                assert "day " in s["title"] and "/5" in s["title"], s["title"]
        finally:
            requests.delete(f"{BASE_URL}/api/schedule/{eid}", headers=auth, timeout=30)

    def test_calendar_single_day_no_suffix(self, auth):
        payload = {
            "title": f"TEST_single_{uuid.uuid4().hex[:6]}",
            "date": "2026-08-15",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200
        eid = r.json()[0]["id"]
        title = payload["title"]
        try:
            c = requests.get(
                f"{BASE_URL}/api/calendar",
                params={"start": "2026-08-01", "end": "2026-08-31"},
                headers=auth,
                timeout=30,
            )
            items = c.json()["items"]
            sched = [i for i in items if i["kind"] == "schedule" and i["title"].startswith(title)]
            assert len(sched) == 1
            assert "day " not in sched[0]["title"]
        finally:
            requests.delete(f"{BASE_URL}/api/schedule/{eid}", headers=auth, timeout=30)

    def test_calendar_equal_end_date_no_suffix(self, auth):
        payload = {
            "title": f"TEST_equal_{uuid.uuid4().hex[:6]}",
            "date": "2026-08-20",
            "end_date": "2026-08-20",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200
        eid = r.json()[0]["id"]
        title = payload["title"]
        try:
            c = requests.get(
                f"{BASE_URL}/api/calendar",
                params={"start": "2026-08-01", "end": "2026-08-31"},
                headers=auth,
                timeout=30,
            )
            items = c.json()["items"]
            sched = [i for i in items if i["kind"] == "schedule" and i["title"].startswith(title)]
            assert len(sched) == 1
            assert "day " not in sched[0]["title"], sched[0]["title"]
        finally:
            requests.delete(f"{BASE_URL}/api/schedule/{eid}", headers=auth, timeout=30)

    def test_recurring_regression(self, auth):
        payload = {
            "title": f"TEST_recur_{uuid.uuid4().hex[:6]}",
            "date": "2026-09-01",
            "recurrence_rule": {
                "frequency": "weekly",
                "days_of_week": [2],  # Tue
                "until": "2026-09-22",
            },
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200
        arr = r.json()
        assert len(arr) >= 3
        ids = [e["id"] for e in arr]
        try:
            # ensure calendar shows each occurrence (single-day, no day suffix)
            c = requests.get(
                f"{BASE_URL}/api/calendar",
                params={"start": "2026-09-01", "end": "2026-09-30"},
                headers=auth,
                timeout=30,
            )
            items = c.json()["items"]
            sched = [i for i in items if i["kind"] == "schedule" and i["title"].startswith(payload["title"])]
            assert len(sched) == len(arr)
            for s in sched:
                assert "day " not in s["title"]
        finally:
            for i in ids:
                requests.delete(f"{BASE_URL}/api/schedule/{i}", headers=auth, timeout=30)


# -------- Fundraiser share --------
class TestFundraiserShare:
    @pytest.fixture
    def fund(self, auth):
        payload = {
            "name": f"TEST_share_{uuid.uuid4().hex[:6]}",
            "amount_raised": 250.0,
            "raised_on": "2026-01-15",
            "note": "TEST share note",
        }
        r = requests.post(f"{BASE_URL}/api/fundraisers", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200, r.text
        f = r.json()
        yield f
        requests.delete(f"{BASE_URL}/api/fundraisers/{f['id']}", headers=auth, timeout=30)

    def test_share_enable_returns_token(self, auth, fund):
        r = requests.post(
            f"{BASE_URL}/api/fundraisers/{fund['id']}/share",
            json={"enabled": True},
            headers=auth,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["is_public"] is True
        assert data.get("share_token")
        assert len(data["share_token"]) >= 8

    def test_public_get_returns_data(self, auth, fund):
        s = requests.post(
            f"{BASE_URL}/api/fundraisers/{fund['id']}/share",
            json={"enabled": True},
            headers=auth,
            timeout=30,
        )
        token = s.json()["share_token"]
        # no auth header
        r = requests.get(f"{BASE_URL}/api/public/fundraisers/{token}", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == fund["name"]
        assert data["amount_raised"] == 250.0
        assert data["available"] == 250.0
        assert data["raised_on"] == "2026-01-15"
        assert data["note"] == "TEST share note"

    def test_public_get_bad_token_404(self):
        r = requests.get(f"{BASE_URL}/api/public/fundraisers/deadbeef_bad_token_xyz", timeout=30)
        assert r.status_code == 404

    def test_share_disable_makes_public_404(self, auth, fund):
        s = requests.post(
            f"{BASE_URL}/api/fundraisers/{fund['id']}/share",
            json={"enabled": True},
            headers=auth,
            timeout=30,
        )
        token = s.json()["share_token"]
        # confirm accessible
        assert requests.get(f"{BASE_URL}/api/public/fundraisers/{token}", timeout=30).status_code == 200
        # disable
        r = requests.post(
            f"{BASE_URL}/api/fundraisers/{fund['id']}/share",
            json={"enabled": False},
            headers=auth,
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["is_public"] is False
        # now 404
        r2 = requests.get(f"{BASE_URL}/api/public/fundraisers/{token}", timeout=30)
        assert r2.status_code == 404
