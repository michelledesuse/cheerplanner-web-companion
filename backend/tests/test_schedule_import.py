"""Backend tests for the Schedule import feature.

Covers:
- GET /api/import/template/schedule (CSV header + example rows + Content-Disposition)
- POST /api/import/preview (CSV parsing, recurrence_rule, event_type mapping,
  12h->24h conversion, days-of-week parsing)
- POST /api/import/commit (creates ScheduleEvent docs, expands recurrence into a
  shared series_id, auto-creates referenced athletes, returns warnings)
- After commit: GET /api/schedule lists imported events
- After commit: GET /api/calendar shows every recurring instance
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def auth_client():
    """Sign up a fresh user and return a requests.Session with bearer token."""
    s = requests.Session()
    email = f"TEST_schedimport_{uuid.uuid4().hex[:10]}@mailinator.com"
    pw = "ImportTest!123"
    r = s.post(f"{BASE_URL}/api/auth/signup", json={
        "email": email, "password": pw, "name": "ImportTester",
    }, timeout=20)
    assert r.status_code in (200, 201), f"signup failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    if not token:
        # fallback: login
        r2 = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
        assert r2.status_code == 200, r2.text
        token = r2.json().get("token") or r2.json().get("access_token")
    assert token, f"no token from signup: {r.text}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


SCHEDULE_CSV = (
    "Title,Type,Date,Start Time,End Time,Location,Athletes,"
    "Repeats,Repeat Days,Repeat Until,Notes\n"
    "Senior 5 practice,Practice,2025-09-02,7:30 PM,9:30 PM,"
    "California Allstars,\"Ava ImportTest, Mia ImportTest\","
    "Weekly,\"Tue,Thu\",2025-09-30,Wear comp shoes\n"
    "Private tumbling,Private Lesson,2025-09-05,4:00 PM,5:00 PM,"
    "Gym B,Ava ImportTest,Weekly,Fri,2025-09-26,\n"
    "Team bonding pizza,Team Bonding,2025-09-13,7:00 PM,9:00 PM,"
    "Coach's house,\"Ava ImportTest, Mia ImportTest\",,,,Bring drink\n"
)


# ---------------------------------------------------------------------------
# /api/import/template/schedule
# ---------------------------------------------------------------------------
class TestScheduleTemplate:

    def test_template_status_and_content_type(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/import/template/schedule", timeout=15)
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "").lower()

    def test_template_content_disposition(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/import/template/schedule", timeout=15)
        cd = r.headers.get("content-disposition", "")
        assert "cheerplanner-schedule-template.csv" in cd, cd

    def test_template_header_row(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/import/template/schedule", timeout=15)
        lines = [ln for ln in r.text.splitlines() if ln.strip()]
        assert lines, "empty template"
        expected = "Title,Type,Date,Start Time,End Time,Location,Athletes,Repeats,Repeat Days,Repeat Until,Notes"
        assert lines[0] == expected, lines[0]

    def test_template_has_at_least_3_example_rows(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/import/template/schedule", timeout=15)
        lines = [ln for ln in r.text.splitlines() if ln.strip()]
        # 1 header + >=3 example rows
        assert len(lines) >= 4, f"only {len(lines)} lines in template"


# ---------------------------------------------------------------------------
# /api/import/preview
# ---------------------------------------------------------------------------
class TestSchedulePreview:

    @pytest.fixture(scope="class")
    def preview_data(self, auth_client):
        files = {"file": ("schedule.csv", SCHEDULE_CSV, "text/csv")}
        data = {"kind": "schedule"}
        r = auth_client.post(f"{BASE_URL}/api/import/preview", files=files, data=data, timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    def test_preview_returns_rows(self, preview_data):
        assert preview_data["kind"] == "schedule"
        assert isinstance(preview_data["rows"], list)
        assert len(preview_data["rows"]) == 3

    def test_preview_event_type_mapping(self, preview_data):
        rows = preview_data["rows"]
        by_title = {r["title"]: r for r in rows}
        assert by_title["Senior 5 practice"]["event_type"] == "practice"
        assert by_title["Private tumbling"]["event_type"] == "private_lesson"
        assert by_title["Team bonding pizza"]["event_type"] == "team_bonding"

    def test_preview_time_12h_to_24h(self, preview_data):
        by_title = {r["title"]: r for r in preview_data["rows"]}
        assert by_title["Senior 5 practice"]["start_time"] == "19:30"
        assert by_title["Senior 5 practice"]["end_time"] == "21:30"
        assert by_title["Private tumbling"]["start_time"] == "16:00"
        assert by_title["Team bonding pizza"]["start_time"] == "19:00"

    def test_preview_recurrence_rule_weekly_tue_thu(self, preview_data):
        by_title = {r["title"]: r for r in preview_data["rows"]}
        rule = by_title["Senior 5 practice"]["recurrence_rule"]
        assert rule is not None, "weekly row should have recurrence_rule"
        assert rule["frequency"] == "weekly"
        assert rule["days_of_week"] == [2, 4], rule  # Tue=2, Thu=4 (Sun=0)
        assert rule["until"] == "2025-09-30"

    def test_preview_recurrence_rule_weekly_fri(self, preview_data):
        by_title = {r["title"]: r for r in preview_data["rows"]}
        rule = by_title["Private tumbling"]["recurrence_rule"]
        assert rule is not None
        assert rule["frequency"] == "weekly"
        assert rule["days_of_week"] == [5]  # Fri=5
        assert rule["until"] == "2025-09-26"

    def test_preview_non_recurring_has_no_rule(self, preview_data):
        by_title = {r["title"]: r for r in preview_data["rows"]}
        rule = by_title["Team bonding pizza"]["recurrence_rule"]
        assert rule is None, f"non-recurring row should NOT have recurrence_rule, got {rule}"

    def test_preview_returns_existing_athletes(self, preview_data):
        assert "existing_athletes" in preview_data
        assert isinstance(preview_data["existing_athletes"], list)


# ---------------------------------------------------------------------------
# /api/import/commit
# ---------------------------------------------------------------------------
class TestScheduleCommit:

    @pytest.fixture(scope="class")
    def committed(self, auth_client):
        # Preview first
        files = {"file": ("schedule.csv", SCHEDULE_CSV, "text/csv")}
        data = {"kind": "schedule"}
        prev = auth_client.post(f"{BASE_URL}/api/import/preview", files=files, data=data, timeout=20)
        assert prev.status_code == 200, prev.text
        rows = prev.json()["rows"]

        # Commit
        r = auth_client.post(
            f"{BASE_URL}/api/import/commit",
            json={"kind": "schedule", "rows": rows},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_commit_status_and_counts(self, committed):
        assert "created" in committed
        # 2 recurring rows expand to multiple events + 1 single = several events
        # weekly Tue/Thu 2025-09-02..2025-09-30 -> Sep 2,4,9,11,16,18,23,25,30 = 9 occurrences
        # weekly Fri 2025-09-05..2025-09-26 -> Sep 5,12,19,26 = 4 occurrences
        # single team bonding = 1
        # Total = 14
        assert committed["created"] == 14, f"expected 14 events, got {committed['created']} (resp={committed})"

    def test_commit_auto_creates_athletes_and_warns(self, committed):
        warnings = committed.get("warnings") or []
        joined = " | ".join(warnings)
        # At least one warning per net-new athlete (Ava ImportTest, Mia ImportTest)
        assert any("Ava ImportTest" in w for w in warnings), f"missing Ava warning: {joined}"
        assert any("Mia ImportTest" in w for w in warnings), f"missing Mia warning: {joined}"
        # Should not duplicate athlete creation across multiple referencing rows
        ava_warnings = [w for w in warnings if "Ava ImportTest" in w]
        mia_warnings = [w for w in warnings if "Mia ImportTest" in w]
        assert len(ava_warnings) == 1, f"Ava should be auto-created exactly once, got {ava_warnings}"
        assert len(mia_warnings) == 1, f"Mia should be auto-created exactly once, got {mia_warnings}"

    def test_commit_persisted_athletes(self, auth_client, committed):
        r = auth_client.get(f"{BASE_URL}/api/athletes", timeout=15)
        assert r.status_code == 200, r.text
        names = {a["name"] for a in r.json()}
        assert "Ava ImportTest" in names
        assert "Mia ImportTest" in names

    def test_schedule_list_contains_imported_events(self, auth_client, committed):
        r = auth_client.get(f"{BASE_URL}/api/schedule", timeout=15)
        assert r.status_code == 200, r.text
        events = r.json()
        titles = {e["title"] for e in events}
        assert "Senior 5 practice" in titles
        assert "Private tumbling" in titles
        assert "Team bonding pizza" in titles

    def test_recurring_rows_share_series_id(self, auth_client, committed):
        r = auth_client.get(f"{BASE_URL}/api/schedule", timeout=15)
        events = r.json()
        senior = [e for e in events if e["title"] == "Senior 5 practice"]
        assert len(senior) == 9, f"weekly Tue/Thu Sep 2->Sep 30 = 9 occurrences, got {len(senior)}"
        series_ids = {e.get("series_id") for e in senior}
        assert len(series_ids) == 1, f"all recurring events should share same series_id, got {series_ids}"
        assert next(iter(series_ids)), "series_id should be non-empty"
        # recurrence_rule populated on each
        for e in senior:
            assert e.get("recurrence_rule"), f"missing recurrence_rule on {e}"
            assert e["recurrence_rule"]["frequency"] == "weekly"
            assert e["recurrence_rule"]["days_of_week"] == [2, 4]

    def test_non_recurring_row_has_no_series(self, auth_client, committed):
        r = auth_client.get(f"{BASE_URL}/api/schedule", timeout=15)
        events = r.json()
        bonding = [e for e in events if e["title"] == "Team bonding pizza"]
        assert len(bonding) == 1, f"non-recurring row should produce exactly 1 event, got {len(bonding)}"
        ev = bonding[0]
        # series_id absent OR null; recurrence_rule absent OR null
        assert not ev.get("series_id"), f"non-recurring shouldn't have series_id, got {ev.get('series_id')}"
        assert not ev.get("recurrence_rule"), f"non-recurring shouldn't have rule, got {ev.get('recurrence_rule')}"

    def test_event_has_athlete_ids_resolved(self, auth_client, committed):
        r = auth_client.get(f"{BASE_URL}/api/schedule", timeout=15)
        events = r.json()
        senior = [e for e in events if e["title"] == "Senior 5 practice"][0]
        assert isinstance(senior.get("athlete_ids"), list)
        assert len(senior["athlete_ids"]) == 2, senior.get("athlete_ids")

    def test_calendar_shows_recurring_occurrences(self, auth_client, committed):
        # /api/calendar should surface each occurrence as a separate entry on its date
        r = auth_client.get(f"{BASE_URL}/api/calendar", params={
            "start": "2025-09-01", "end": "2025-09-30"
        }, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body["items"] if isinstance(body, dict) else body
        # Find calendar entries for "Senior 5 practice"
        sched_items = [
            it for it in items
            if it.get("kind") == "schedule" and "Senior 5 practice" in (it.get("title") or "")
        ]
        assert len(sched_items) == 9, (
            f"expected 9 calendar occurrences for Senior 5 practice in Sep 2025, "
            f"got {len(sched_items)}"
        )
        # Verify dates are the expected Tue/Thu pattern
        dates = sorted({it.get("date") for it in sched_items})
        expected_dates = [
            "2025-09-02", "2025-09-04", "2025-09-09", "2025-09-11",
            "2025-09-16", "2025-09-18", "2025-09-23", "2025-09-25",
            "2025-09-30",
        ]
        assert dates == expected_dates, f"date mismatch: {dates}"


# ---------------------------------------------------------------------------
# Negative / sanity
# ---------------------------------------------------------------------------
class TestScheduleImportErrors:

    def test_template_unknown_kind_400(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/import/template/bogus", timeout=10)
        assert r.status_code == 400

    def test_preview_requires_auth(self):
        files = {"file": ("schedule.csv", SCHEDULE_CSV, "text/csv")}
        r = requests.post(
            f"{BASE_URL}/api/import/preview",
            files=files, data={"kind": "schedule"}, timeout=15,
        )
        assert r.status_code in (401, 403), r.status_code
