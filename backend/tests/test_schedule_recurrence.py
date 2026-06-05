"""Tests for recurring schedule events endpoints.

Covers:
- POST /api/schedule (single + recurrence: daily/weekly/biweekly/monthly)
- GET /api/schedule (series_id + recurrence_rule populated)
- PATCH /api/schedule/{id}?scope=single|series
- DELETE /api/schedule/{id}?scope=single|series
- GET /api/calendar (recurring events appear as individual daily entries)
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


# ---------- Helpers ----------
def _signup_or_login():
    email = f"TEST_sched_{uuid.uuid4().hex[:8]}@mailinator.com"
    password = "TestPass123!"
    r = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={"email": email, "password": password, "name": "Recur Tester"},
        timeout=30,
    )
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    return r.json()["access_token"], email


def _next_weekday(target_weekday: int) -> date:
    """Return the next date (>= tomorrow) whose Python weekday() equals target_weekday (Mon=0..Sun=6)."""
    today = date.today()
    # Start from tomorrow so we always have stable future dates.
    cand = today + timedelta(days=1)
    while cand.weekday() != target_weekday:
        cand = cand + timedelta(days=1)
    return cand


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def auth_headers():
    token, _email = _signup_or_login()
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Tests ----------
class TestScheduleSingleAndList:
    """Non-recurring schedule create + list."""

    def test_create_single_event_returns_list_of_one(self, auth_headers):
        d = (date.today() + timedelta(days=2)).isoformat()
        payload = {
            "title": "TEST one-off practice",
            "event_type": "practice",
            "date": d,
            "start_time": "18:00",
            "end_time": "19:00",
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list), "POST /api/schedule must always return a list"
        assert len(body) == 1
        ev = body[0]
        assert ev["title"] == payload["title"]
        assert ev["date"] == d
        assert ev.get("series_id") in (None, "")
        assert ev.get("recurrence_rule") in (None, {}, )
        # cleanup
        requests.delete(f"{BASE_URL}/api/schedule/{ev['id']}", headers=auth_headers, timeout=30)


class TestScheduleWeeklyRecurrence:
    """Weekly Tuesday recurrence."""

    def test_weekly_tuesday_until_three_weeks(self, auth_headers):
        # Tuesday = Python weekday 1; rule format Sun=0..Sat=6 → Tue = 2.
        start = _next_weekday(1)  # next Tuesday
        until = start + timedelta(days=21)  # 3 weeks later (inclusive)
        payload = {
            "title": "TEST weekly Tue practice",
            "event_type": "practice",
            "date": start.isoformat(),
            "start_time": "19:30",
            "recurrence_rule": {
                "frequency": "weekly",
                "days_of_week": [2],  # Tuesday in Sun=0..Sat=6 format
                "until": until.isoformat(),
            },
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        assert isinstance(events, list)
        # start..start+21 inclusive every Tue → 4 occurrences
        assert len(events) == 4, f"expected 4 weekly Tuesdays, got {len(events)}: {[e['date'] for e in events]}"

        series_ids = {e.get("series_id") for e in events}
        assert len(series_ids) == 1 and None not in series_ids, f"all events must share one series_id: {series_ids}"
        series_id = events[0]["series_id"]

        # Every date must be a Tuesday
        for e in events:
            d = date.fromisoformat(e["date"])
            assert d.weekday() == 1, f"non-Tuesday in series: {e['date']}"
            assert e.get("recurrence_rule"), "recurrence_rule should be populated on each instance"
            assert e["recurrence_rule"]["frequency"] == "weekly"

        # GET list returns the same series
        r2 = requests.get(f"{BASE_URL}/api/schedule", headers=auth_headers, timeout=30)
        assert r2.status_code == 200
        all_events = r2.json()
        in_series = [e for e in all_events if e.get("series_id") == series_id]
        assert len(in_series) == len(events)

        # cleanup series
        any_id = events[0]["id"]
        rd = requests.delete(
            f"{BASE_URL}/api/schedule/{any_id}?scope=series", headers=auth_headers, timeout=30
        )
        assert rd.status_code == 200
        assert rd.json().get("deleted") == len(events)


class TestScheduleBiweekly:
    """Biweekly should skip alternating weeks."""

    def test_biweekly_skips_alternating_weeks(self, auth_headers):
        start = _next_weekday(1)  # next Tuesday
        until = start + timedelta(days=42)  # 6 weeks ⇒ should yield 4 occurrences (weeks 0,2,4,6)
        payload = {
            "title": "TEST biweekly Tue",
            "event_type": "practice",
            "date": start.isoformat(),
            "recurrence_rule": {
                "frequency": "biweekly",
                "days_of_week": [2],
                "until": until.isoformat(),
            },
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        dates = sorted([date.fromisoformat(e["date"]) for e in events])
        assert len(dates) == 4, f"expected 4 biweekly occurrences, got {len(dates)}: {dates}"
        # all Tuesdays and gaps of 14 days
        for i, d in enumerate(dates):
            assert d.weekday() == 1
            if i > 0:
                assert (d - dates[i - 1]).days == 14, f"biweekly gap broken at index {i}: {dates}"
        # cleanup
        requests.delete(
            f"{BASE_URL}/api/schedule/{events[0]['id']}?scope=series", headers=auth_headers, timeout=30
        )


class TestScheduleDaily:
    """Daily creates one event per day inclusive."""

    def test_daily_inclusive(self, auth_headers):
        start = date.today() + timedelta(days=1)
        until = start + timedelta(days=4)  # 5 days inclusive
        payload = {
            "title": "TEST daily",
            "event_type": "practice",
            "date": start.isoformat(),
            "recurrence_rule": {
                "frequency": "daily",
                "days_of_week": [],
                "until": until.isoformat(),
            },
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        assert len(events) == 5, f"expected 5 daily events, got {len(events)}"
        dates = sorted(e["date"] for e in events)
        expected = [(start + timedelta(days=i)).isoformat() for i in range(5)]
        assert dates == expected
        # cleanup
        requests.delete(
            f"{BASE_URL}/api/schedule/{events[0]['id']}?scope=series", headers=auth_headers, timeout=30
        )


class TestScheduleMonthly:
    """Monthly creates one event per month on the start day-of-month."""

    def test_monthly_same_day_of_month(self, auth_headers):
        # Use day 5 so we don't hit Feb-30 edge cases.
        today = date.today()
        start_year = today.year
        start_month = today.month + 1
        if start_month > 12:
            start_month = 1
            start_year += 1
        start = date(start_year, start_month, 5)
        # Add 3 months
        end_month = start.month + 3
        end_year = start.year
        while end_month > 12:
            end_month -= 12
            end_year += 1
        until = date(end_year, end_month, 5)

        payload = {
            "title": "TEST monthly",
            "event_type": "practice",
            "date": start.isoformat(),
            "recurrence_rule": {
                "frequency": "monthly",
                "days_of_week": [],
                "until": until.isoformat(),
            },
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        assert len(events) == 4, f"expected 4 monthly events, got {len(events)}"
        for e in events:
            d = date.fromisoformat(e["date"])
            assert d.day == 5, f"monthly should land on day 5, got {d}"
        # cleanup
        requests.delete(
            f"{BASE_URL}/api/schedule/{events[0]['id']}?scope=series", headers=auth_headers, timeout=30
        )


class TestPatchSingleVsSeries:
    """PATCH ?scope=single vs scope=series."""

    def _make_weekly_series(self, auth_headers):
        start = _next_weekday(1)
        until = start + timedelta(days=14)  # 3 occurrences
        payload = {
            "title": "TEST patch series",
            "event_type": "practice",
            "date": start.isoformat(),
            "start_time": "19:30",
            "recurrence_rule": {
                "frequency": "weekly",
                "days_of_week": [2],
                "until": until.isoformat(),
            },
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        assert len(events) >= 2
        return events

    def test_patch_single_does_not_affect_siblings(self, auth_headers):
        events = self._make_weekly_series(auth_headers)
        target = events[0]
        siblings = events[1:]

        r = requests.patch(
            f"{BASE_URL}/api/schedule/{target['id']}?scope=single",
            json={"title": "TEST patched-single only"},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("scope") == "single"
        assert body.get("updated") == 1
        assert body["events"][0]["title"] == "TEST patched-single only"

        # Verify siblings unchanged
        r2 = requests.get(f"{BASE_URL}/api/schedule", headers=auth_headers, timeout=30)
        assert r2.status_code == 200
        by_id = {e["id"]: e for e in r2.json()}
        for sib in siblings:
            assert by_id[sib["id"]]["title"] == "TEST patch series", \
                f"sibling unexpectedly updated: {by_id[sib['id']]['title']}"
        # cleanup
        requests.delete(
            f"{BASE_URL}/api/schedule/{target['id']}?scope=series", headers=auth_headers, timeout=30
        )

    def test_patch_series_updates_all_but_keeps_dates(self, auth_headers):
        events = self._make_weekly_series(auth_headers)
        target = events[0]
        original_dates = {e["id"]: e["date"] for e in events}

        # Try to also include a date — must NOT propagate; only this instance's date may change.
        r = requests.patch(
            f"{BASE_URL}/api/schedule/{target['id']}?scope=series",
            json={"title": "TEST series-updated", "start_time": "20:00"},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("scope") == "series"
        assert body.get("updated") == len(events)
        assert len(body.get("events", [])) == len(events)

        # All siblings should have new title + start_time, and dates unchanged.
        r2 = requests.get(f"{BASE_URL}/api/schedule", headers=auth_headers, timeout=30)
        by_id = {e["id"]: e for e in r2.json()}
        for ev in events:
            cur = by_id[ev["id"]]
            assert cur["title"] == "TEST series-updated"
            assert cur.get("start_time") == "20:00"
            assert cur["date"] == original_dates[ev["id"]], \
                f"date should NOT change on series update: {cur['date']} vs {original_dates[ev['id']]}"
        # cleanup
        requests.delete(
            f"{BASE_URL}/api/schedule/{target['id']}?scope=series", headers=auth_headers, timeout=30
        )


class TestDeleteSingleVsSeries:
    def _make_weekly_series(self, auth_headers):
        start = _next_weekday(1)
        until = start + timedelta(days=14)
        payload = {
            "title": "TEST delete series",
            "event_type": "practice",
            "date": start.isoformat(),
            "recurrence_rule": {
                "frequency": "weekly",
                "days_of_week": [2],
                "until": until.isoformat(),
            },
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_delete_single_removes_only_one(self, auth_headers):
        events = self._make_weekly_series(auth_headers)
        target = events[0]
        r = requests.delete(
            f"{BASE_URL}/api/schedule/{target['id']}?scope=single",
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("scope") == "single"
        assert body.get("deleted") == 1

        r2 = requests.get(f"{BASE_URL}/api/schedule", headers=auth_headers, timeout=30)
        all_ids = {e["id"] for e in r2.json()}
        assert target["id"] not in all_ids
        for sib in events[1:]:
            assert sib["id"] in all_ids, "sibling should still exist after scope=single delete"

        # cleanup remaining series
        requests.delete(
            f"{BASE_URL}/api/schedule/{events[1]['id']}?scope=series", headers=auth_headers, timeout=30
        )

    def test_delete_series_removes_all(self, auth_headers):
        events = self._make_weekly_series(auth_headers)
        target = events[0]
        r = requests.delete(
            f"{BASE_URL}/api/schedule/{target['id']}?scope=series",
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("scope") == "series"
        assert body.get("deleted") == len(events)

        r2 = requests.get(f"{BASE_URL}/api/schedule", headers=auth_headers, timeout=30)
        remaining_ids = {e["id"] for e in r2.json()}
        for ev in events:
            assert ev["id"] not in remaining_ids, f"series event {ev['id']} should have been deleted"


class TestCalendarShowsRecurringEvents:
    def test_calendar_lists_each_recurring_occurrence(self, auth_headers):
        start = _next_weekday(1)
        until = start + timedelta(days=14)  # 3 Tuesdays
        payload = {
            "title": "TEST calendar weekly",
            "event_type": "practice",
            "date": start.isoformat(),
            "start_time": "19:30",
            "recurrence_rule": {
                "frequency": "weekly",
                "days_of_week": [2],
                "until": until.isoformat(),
            },
        }
        r = requests.post(f"{BASE_URL}/api/schedule", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        assert len(events) >= 2

        cal_start = (date.today() - timedelta(days=1)).isoformat()
        cal_end = (until + timedelta(days=1)).isoformat()
        rc = requests.get(
            f"{BASE_URL}/api/calendar",
            params={"start": cal_start, "end": cal_end},
            headers=auth_headers,
            timeout=30,
        )
        assert rc.status_code == 200, rc.text
        cal_items = rc.json().get("items", [])
        sched_items = [
            i for i in cal_items
            if i.get("kind") == "schedule" and i.get("title") == "TEST calendar weekly"
        ]
        assert len(sched_items) == len(events), \
            f"calendar should expose every recurring instance: got {len(sched_items)} vs {len(events)}"
        # each is on a different date
        cal_dates = sorted({i["date"] for i in sched_items})
        assert len(cal_dates) == len(events)
        # cleanup
        requests.delete(
            f"{BASE_URL}/api/schedule/{events[0]['id']}?scope=series", headers=auth_headers, timeout=30
        )
