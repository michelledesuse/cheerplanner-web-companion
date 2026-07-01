"""Backend tests for CheerPlanner v2.2:
- Feature #5: Calendar Day/Week/Month toggle uses same /api/calendar feed with start/end range
- Feature #6b: Fundraiser goal_amount create/update/read + public share exposes goal_amount
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


# -------- Fundraiser goal_amount --------
class TestFundraiserGoal:
    created_ids: list = []

    def test_create_with_goal_persists(self, auth):
        name = f"TEST_goal_{uuid.uuid4().hex[:6]}"
        payload = {"name": name, "amount_raised": 250, "raised_on": "2026-02-10", "goal_amount": 1000}
        r = requests.post(f"{BASE_URL}/api/fundraisers", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200, r.text
        fr = r.json()
        assert fr["goal_amount"] == 1000
        assert fr["name"] == name
        self.__class__.created_ids.append(fr["id"])

        # GET verify persistence
        g = requests.get(f"{BASE_URL}/api/fundraisers", headers=auth, timeout=30)
        assert g.status_code == 200
        match = next((x for x in g.json() if x["id"] == fr["id"]), None)
        assert match is not None
        assert match["goal_amount"] == 1000

    def test_create_without_goal_returns_null(self, auth):
        name = f"TEST_nogoal_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/fundraisers", json={"name": name, "amount_raised": 50, "raised_on": "2026-02-11"}, headers=auth, timeout=30)
        assert r.status_code == 200
        fr = r.json()
        assert fr.get("goal_amount") in (None, 0) or fr["goal_amount"] is None
        self.__class__.created_ids.append(fr["id"])

    def test_patch_updates_goal(self, auth):
        # create
        r = requests.post(f"{BASE_URL}/api/fundraisers", json={"name": f"TEST_patch_{uuid.uuid4().hex[:6]}", "amount_raised": 100, "raised_on": "2026-02-12"}, headers=auth, timeout=30)
        assert r.status_code == 200
        fid = r.json()["id"]
        self.__class__.created_ids.append(fid)
        # patch goal
        p = requests.patch(f"{BASE_URL}/api/fundraisers/{fid}", json={"goal_amount": 500}, headers=auth, timeout=30)
        assert p.status_code == 200, p.text
        assert p.json()["goal_amount"] == 500
        # verify via GET
        g = requests.get(f"{BASE_URL}/api/fundraisers", headers=auth, timeout=30)
        match = next(x for x in g.json() if x["id"] == fid)
        assert match["goal_amount"] == 500

    def test_public_endpoint_returns_goal(self, auth):
        # create with goal + share
        r = requests.post(f"{BASE_URL}/api/fundraisers", json={"name": f"TEST_public_{uuid.uuid4().hex[:6]}", "amount_raised": 300, "raised_on": "2026-02-13", "goal_amount": 750}, headers=auth, timeout=30)
        assert r.status_code == 200
        fid = r.json()["id"]
        self.__class__.created_ids.append(fid)
        s = requests.post(f"{BASE_URL}/api/fundraisers/{fid}/share", json={"enabled": True}, headers=auth, timeout=30)
        assert s.status_code == 200
        tok = s.json()["share_token"]
        # unauthenticated fetch
        pub = requests.get(f"{BASE_URL}/api/public/fundraisers/{tok}", timeout=30)
        assert pub.status_code == 200, pub.text
        body = pub.json()
        assert body["goal_amount"] == 750
        assert body["amount_raised"] == 300
        assert "name" in body

    def test_public_endpoint_no_goal_returns_null(self, auth):
        r = requests.post(f"{BASE_URL}/api/fundraisers", json={"name": f"TEST_nopub_{uuid.uuid4().hex[:6]}", "amount_raised": 40, "raised_on": "2026-02-14"}, headers=auth, timeout=30)
        assert r.status_code == 200
        fid = r.json()["id"]
        self.__class__.created_ids.append(fid)
        s = requests.post(f"{BASE_URL}/api/fundraisers/{fid}/share", json={"enabled": True}, headers=auth, timeout=30)
        assert s.status_code == 200
        tok = s.json()["share_token"]
        pub = requests.get(f"{BASE_URL}/api/public/fundraisers/{tok}", timeout=30)
        assert pub.status_code == 200
        assert pub.json()["goal_amount"] in (None, 0) or pub.json()["goal_amount"] is None

    @classmethod
    def teardown_class(cls):
        # cleanup
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
        if r.status_code == 200:
            h = {"Authorization": f"Bearer {r.json()['access_token']}"}
            for fid in cls.created_ids:
                try:
                    requests.delete(f"{BASE_URL}/api/fundraisers/{fid}", headers=h, timeout=30)
                except Exception:
                    pass


# -------- Calendar range (day / week / month) --------
class TestCalendarRange:
    created_events: list = []

    @classmethod
    def setup_class(cls):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
        assert r.status_code == 200
        cls.auth_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        # Create a multi-day event to test range filtering and 'day N/total' rendering
        payload = {
            "title": f"TEST_calview_{uuid.uuid4().hex[:6]}",
            "event_type": "choreography",
            "date": "2026-03-02",  # Monday
            "end_date": "2026-03-06",  # Friday (5-day span)
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=cls.auth_h, timeout=30)
        assert r.status_code == 200
        cls.event_id = r.json()[0]["id"]
        cls.event_title = payload["title"]
        cls.created_events.append(cls.event_id)

    @classmethod
    def teardown_class(cls):
        for eid in cls.created_events:
            try:
                requests.delete(f"{BASE_URL}/api/schedule/{eid}", headers=cls.auth_h, timeout=30)
            except Exception:
                pass

    def _fetch(self, start, end):
        r = requests.get(f"{BASE_URL}/api/calendar?start={start}&end={end}", headers=self.auth_h, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()["items"]

    def test_day_range_returns_only_that_day(self):
        items = self._fetch("2026-03-03", "2026-03-03")
        for it in items:
            assert it["date"] == "2026-03-03"
        # our multi-day event should include this day as 'day 2/5'
        mine = [it for it in items if it["title"].startswith(self.event_title)]
        assert len(mine) == 1
        assert "day 2/5" in mine[0]["title"]

    def test_week_range_returns_seven_days_slice(self):
        # week starting Sunday 2026-03-01 through Saturday 2026-03-07
        items = self._fetch("2026-03-01", "2026-03-07")
        assert all("2026-03-01" <= it["date"] <= "2026-03-07" for it in items)
        # multi-day event should appear on all 5 days within week
        mine = [it for it in items if it["title"].startswith(self.event_title)]
        assert len(mine) == 5
        # 'day X/5' present for each
        for i, day in enumerate(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"], start=1):
            hit = next((it for it in mine if it["date"] == day), None)
            assert hit is not None
            assert f"day {i}/5" in hit["title"]

    def test_month_range_returns_full_span(self):
        items = self._fetch("2026-03-01", "2026-03-31")
        assert all("2026-03-01" <= it["date"] <= "2026-03-31" for it in items)
        mine = [it for it in items if it["title"].startswith(self.event_title)]
        # 5 days of span all within March
        assert len(mine) == 5

    def test_out_of_range_excludes_event(self):
        items = self._fetch("2026-04-01", "2026-04-30")
        mine = [it for it in items if it["title"].startswith(self.event_title)]
        assert mine == []
