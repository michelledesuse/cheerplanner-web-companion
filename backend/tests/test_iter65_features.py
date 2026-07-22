"""Iter65 regression: payment exclude, roster bulk-delete, schedule scope."""
import os
import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or _env.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestPaymentExclude:
    def test_exclude_flow(self, hdr):
        # create 2 roster members
        m1 = requests.post(f"{BASE_URL}/api/roster", json={"name": "TEST_Alice65", "role": "athlete"}, headers=hdr).json()
        m2 = requests.post(f"{BASE_URL}/api/roster", json={"name": "TEST_Bob65", "role": "athlete"}, headers=hdr).json()
        try:
            t = requests.post(f"{BASE_URL}/api/team/payments", json={"name": "TEST_Tracker65", "amount": 50}, headers=hdr).json()
            tid = t["id"]
            try:
                # fetch full tracker to get summary
                full = requests.get(f"{BASE_URL}/api/team/payments/{tid}", headers=hdr).json()
                base_total = full["summary"]["member_total"]
                assert base_total >= 2
                # exclude m1
                r = requests.put(f"{BASE_URL}/api/team/payments/{tid}/member/{m1['id']}/exclude", json={"excluded": True}, headers=hdr)
                assert r.status_code == 200, r.text
                data = r.json()
                assert m1["id"] in (data.get("excluded_member_ids") or [])
                assert data["summary"]["member_total"] == base_total - 1
                # un-exclude
                r2 = requests.put(f"{BASE_URL}/api/team/payments/{tid}/member/{m1['id']}/exclude", json={"excluded": False}, headers=hdr)
                assert r2.status_code == 200
                assert m1["id"] not in (r2.json().get("excluded_member_ids") or [])
                assert r2.json()["summary"]["member_total"] == base_total
            finally:
                requests.delete(f"{BASE_URL}/api/team/payments/{tid}", headers=hdr)
        finally:
            requests.delete(f"{BASE_URL}/api/roster/{m1['id']}", headers=hdr)
            requests.delete(f"{BASE_URL}/api/roster/{m2['id']}", headers=hdr)


class TestRosterBulkDelete:
    def test_bulk_delete(self, hdr):
        ids = []
        for n in ["TEST_Bulk1", "TEST_Bulk2", "TEST_Bulk3"]:
            r = requests.post(f"{BASE_URL}/api/roster", json={"name": n, "role": "athlete"}, headers=hdr)
            ids.append(r.json()["id"])
        try:
            r = requests.post(f"{BASE_URL}/api/roster/bulk-delete", json={"ids": ids[:2]}, headers=hdr)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data.get("deleted") == 2
            # verify gone
            all_r = requests.get(f"{BASE_URL}/api/roster", headers=hdr).json()
            all_ids = [m["id"] for m in all_r]
            assert ids[0] not in all_ids
            assert ids[1] not in all_ids
            assert ids[2] in all_ids
        finally:
            requests.delete(f"{BASE_URL}/api/roster/{ids[2]}", headers=hdr)


class TestScheduleScope:
    def test_scope_future(self, hdr):
        # create weekly series across ~5 weeks
        payload = {
            "event_type": "practice",
            "title": "TEST_Series65",
            "date": "2026-02-02",  # Monday
            "start_time": "10:00 AM",
            "end_time": "11:00 AM",
            "recurrence_rule": {"frequency": "weekly", "days_of_week": [1], "until": "2026-03-09"},
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=hdr)
        assert r.status_code in (200, 201), r.text
        # list & find our events
        listing = requests.get(f"{BASE_URL}/api/schedule", headers=hdr).json()
        ours = [e for e in listing if e.get("title") == "TEST_Series65"]
        assert len(ours) >= 3
        ours.sort(key=lambda x: x["date"])
        series_id = ours[0].get("series_id")
        assert series_id
        try:
            middle = ours[len(ours) // 2]
            # patch scope=future changing start_time
            patch_r = requests.patch(
                f"{BASE_URL}/api/schedule/{middle['id']}?scope=future",
                json={"start_time": "2:00 PM"},
                headers=hdr,
            )
            assert patch_r.status_code == 200, patch_r.text
            # re-fetch
            listing2 = requests.get(f"{BASE_URL}/api/schedule", headers=hdr).json()
            ours2 = sorted([e for e in listing2 if e.get("series_id") == series_id], key=lambda x: x["date"])
            for e in ours2:
                if e["date"] < middle["date"]:
                    assert e["start_time"] == "10:00 AM", f"Earlier event should keep old time: {e}"
                else:
                    assert e["start_time"] == "2:00 PM", f"Middle/later should have new time: {e}"
        finally:
            # scope=series delete cleans up
            requests.delete(
                f"{BASE_URL}/api/schedule/{ours[0]['id']}?scope=series", headers=hdr
            )


class TestFinalTeamAccess:
    def test_team_access_still_true(self, hdr):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr)
        assert r.status_code == 200
        assert r.json().get("team_access") is True
