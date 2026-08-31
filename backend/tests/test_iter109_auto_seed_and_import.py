"""iter109 backend tests:
- Scouting auto-seed (idempotent) via GET /api/team/scouting/skills / overview / report
- Import team calendar events into personal /schedule (single + all + recurring)
- Recurrence mapping (weekly, biweekly, daily, monthly, none)
- Weekly weekday fix (byweekday Sun=0..Sat=6) in GET /api/team/calendar/events
"""
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

COACH = ("coach.casey@cheerplanner.app", "CheerDemo2026!")
PARENT = ("parent.taylor@cheerplanner.app", "CheerDemo2026!")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def coach_tok():
    return _login(*COACH)


@pytest.fixture(scope="module")
def parent_tok():
    return _login(*PARENT)


# ------------- Auto-seed (idempotency) -------------

class TestAutoSeed:
    def test_skills_endpoint_returns_216_and_is_idempotent(self, coach_tok):
        r1 = requests.get(f"{API}/team/scouting/skills", headers=_hdr(coach_tok), timeout=30)
        assert r1.status_code == 200, r1.text
        cats = r1.json()["categories"]
        total1 = sum(len(v) for v in cats.values())
        assert total1 == 216, f"Expected 216 seeded skills, got {total1}"
        # Categories present with skills
        for c in ("tumbling", "stunting", "jumps"):
            assert c in cats and len(cats[c]) > 0, f"missing category {c}"
        # Levels 1-7
        levels = set()
        for lst in cats.values():
            for s in lst:
                levels.add(s.get("level_group"))
        assert levels == {1, 2, 3, 4, 5, 6, 7}, f"Unexpected levels {levels}"
        # Second call: still 216 (no dupes)
        r2 = requests.get(f"{API}/team/scouting/skills", headers=_hdr(coach_tok), timeout=30)
        total2 = sum(len(v) for v in r2.json()["categories"].values())
        assert total2 == 216, f"After 2nd call expected 216, got {total2}"

    def test_overview_triggers_seed_and_is_idempotent(self, coach_tok):
        r = requests.get(f"{API}/team/scouting/overview", headers=_hdr(coach_tok), timeout=30)
        assert r.status_code == 200
        assert r.json().get("role") == "coach"
        # skills still 216
        r2 = requests.get(f"{API}/team/scouting/skills", headers=_hdr(coach_tok), timeout=30)
        assert sum(len(v) for v in r2.json()["categories"].values()) == 216

    def test_report_endpoint_triggers_seed_and_is_idempotent(self, coach_tok):
        ov = requests.get(f"{API}/team/scouting/overview", headers=_hdr(coach_tok), timeout=30).json()
        athletes = ov.get("athletes") or []
        if not athletes:
            pytest.skip("No athletes visible to coach")
        rid = athletes[0]["roster_id"]
        r = requests.get(f"{API}/team/scouting/report/{rid}", headers=_hdr(coach_tok), timeout=30)
        assert r.status_code == 200, r.text
        # still 216
        r2 = requests.get(f"{API}/team/scouting/skills", headers=_hdr(coach_tok), timeout=30)
        assert sum(len(v) for v in r2.json()["categories"].values()) == 216


# ------------- Team calendar recurrence + weekday fix -------------

_created_team_events = []


def _create_team_event(tok, **kwargs):
    r = requests.post(f"{API}/team/calendar/events", headers=_hdr(tok), json=kwargs, timeout=30)
    assert r.status_code == 200, r.text
    ev = r.json()
    _created_team_events.append(ev["id"])
    return ev


class TestWeekdayExpansion:
    def test_weekly_monday_expands_to_mondays(self, coach_tok):
        # find next Monday
        today = date.today()
        # Monday = 0 (Python)
        days_ahead = (0 - today.weekday()) % 7 or 7
        monday = today + timedelta(days=days_ahead)
        until = monday + timedelta(days=28)
        ev = _create_team_event(
            coach_tok,
            title=f"TEST_iter109_monday_{uuid.uuid4().hex[:6]}",
            date=monday.isoformat(),
            start_time="17:00", end_time="18:00",
            # byweekday Sun=0..Sat=6 -> Monday = 1
            recurrence={"freq": "weekly", "interval": 1, "byweekday": [1], "until": until.isoformat()},
        )
        # list events window covering the range
        r = requests.get(
            f"{API}/team/calendar/events?from_={monday.isoformat()}&to={until.isoformat()}",
            headers=_hdr(coach_tok), timeout=30,
        )
        assert r.status_code == 200
        occs = [e["occ_date"] for e in r.json()["events"] if e["event_id"] == ev["id"]]
        assert len(occs) >= 4, f"expected >=4 mondays, got {occs}"
        for od in occs:
            d = date.fromisoformat(od)
            assert d.weekday() == 0, f"Occurrence {od} is not Monday (weekday={d.weekday()})"


# ------------- Import to personal schedule -------------

_imported_team_event_ids: list = []


class TestPersonalImport:
    def test_single_recurring_import_creates_series_and_dedupes(self, coach_tok, parent_tok):
        # create a weekly-Tuesday team event (Sun=0..Sat=6 -> Tue=2)
        today = date.today()
        days_ahead = (1 - today.weekday()) % 7 or 7  # Python: Tuesday=1
        start = today + timedelta(days=days_ahead)
        until = start + timedelta(days=42)  # 6 weeks
        ev = _create_team_event(
            coach_tok,
            title=f"TEST_iter109_tue_{uuid.uuid4().hex[:6]}",
            date=start.isoformat(),
            start_time="18:00", end_time="19:30", location="Gym A",
            recurrence={"freq": "weekly", "interval": 1, "byweekday": [2], "until": until.isoformat()},
        )
        _imported_team_event_ids.append(ev["id"])

        # parent imports single event -> should create whole series
        r = requests.post(
            f"{API}/team/calendar/import-to-personal",
            headers=_hdr(parent_tok), json={"event_id": ev["id"]}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["already"] is False
        assert body["created"] >= 6, f"expected recurring series creation, got {body}"

        # verify via GET /api/schedule
        sched = requests.get(f"{API}/schedule", headers=_hdr(parent_tok), timeout=30)
        assert sched.status_code == 200, sched.text
        events = sched.json() if isinstance(sched.json(), list) else sched.json().get("events", [])
        # NOTE: response_model=ScheduleEvent strips imported_from_team_event_id.
        # Match rows by title instead (unique per test).
        mine = [e for e in events if e.get("title") == ev["title"]]
        assert len(mine) >= 6, f"schedule rows for series: {len(mine)}"
        # All rows should fall on a Tuesday
        for e in mine:
            d = date.fromisoformat(e["date"][:10])
            assert d.weekday() == 1, f"personal schedule row {e['date']} is not Tuesday"

        # re-call is idempotent
        r2 = requests.post(
            f"{API}/team/calendar/import-to-personal",
            headers=_hdr(parent_tok), json={"event_id": ev["id"]}, timeout=30,
        )
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["already"] is True and b2["created"] == 0

    def test_recurrence_mapping_daily_biweekly_monthly_single(self, coach_tok, parent_tok):
        today = date.today()
        start = today + timedelta(days=1)
        until = start + timedelta(days=30)

        # daily
        ev_d = _create_team_event(
            coach_tok, title=f"TEST_iter109_daily_{uuid.uuid4().hex[:6]}",
            date=start.isoformat(), recurrence={"freq": "daily", "interval": 1, "until": until.isoformat()},
        )
        _imported_team_event_ids.append(ev_d["id"])

        # biweekly (weekly interval=2, byweekday=start.weekday-Sun=0 mapping)
        # Sun=0..Sat=6 -> python weekday x -> (x+1)%7
        js_wd = (start.weekday() + 1) % 7
        ev_bw = _create_team_event(
            coach_tok, title=f"TEST_iter109_biweekly_{uuid.uuid4().hex[:6]}",
            date=start.isoformat(),
            recurrence={"freq": "weekly", "interval": 2, "byweekday": [js_wd], "until": (start + timedelta(days=60)).isoformat()},
        )
        _imported_team_event_ids.append(ev_bw["id"])

        # monthly
        ev_m = _create_team_event(
            coach_tok, title=f"TEST_iter109_monthly_{uuid.uuid4().hex[:6]}",
            date=start.isoformat(),
            recurrence={"freq": "monthly", "interval": 1, "until": (start + timedelta(days=120)).isoformat()},
        )
        _imported_team_event_ids.append(ev_m["id"])

        # single (no recurrence)
        ev_s = _create_team_event(
            coach_tok, title=f"TEST_iter109_single_{uuid.uuid4().hex[:6]}",
            date=start.isoformat(), recurrence={"freq": "none"},
        )
        _imported_team_event_ids.append(ev_s["id"])

        # Import each and verify schedule rows have expected recurrence_rule frequency mapping
        expected = {
            ev_d["id"]: ("daily", None),
            ev_bw["id"]: ("biweekly", 1),  # rows on start's weekday, 14-day spacing
            ev_m["id"]: ("monthly", None),
            ev_s["id"]: (None, None),
        }
        for eid, (freq, _) in expected.items():
            r = requests.post(f"{API}/team/calendar/import-to-personal", headers=_hdr(parent_tok),
                              json={"event_id": eid}, timeout=30)
            assert r.status_code == 200, r.text
            b = r.json()
            assert b["ok"] is True and b["already"] is False, f"import failed for {eid}: {b}"

        sched = requests.get(f"{API}/schedule", headers=_hdr(parent_tok), timeout=30).json()
        events = sched if isinstance(sched, list) else sched.get("events", [])
        # match by title (imported_from_team_event_id is stripped by response_model)
        title_of = {ev_d["id"]: ev_d["title"], ev_bw["id"]: ev_bw["title"],
                    ev_m["id"]: ev_m["title"], ev_s["id"]: ev_s["title"]}

        # single
        singles = [e for e in events if e.get("title") == title_of[ev_s["id"]]]
        assert len(singles) == 1, f"single event expected 1 row, got {len(singles)}"

        # daily >= 20 rows
        dailies = [e for e in events if e.get("title") == title_of[ev_d["id"]]]
        assert len(dailies) >= 20, f"daily expected many rows, got {len(dailies)}"

        # biweekly rows - check spacing 14 days on the same weekday as start
        bws = sorted([e for e in events if e.get("title") == title_of[ev_bw["id"]]],
                     key=lambda e: e["date"])
        assert len(bws) >= 2, f"biweekly expected >=2, got {len(bws)}"
        d0 = date.fromisoformat(bws[0]["date"][:10])
        d1 = date.fromisoformat(bws[1]["date"][:10])
        assert (d1 - d0).days == 14, f"biweekly gap expected 14, got {(d1 - d0).days}"
        for e in bws:
            rr = e.get("recurrence_rule") or {}
            assert rr.get("frequency") == "biweekly", f"expected biweekly, got {rr}"

        # monthly - check first row has recurrence_rule.frequency=monthly
        months = [e for e in events if e.get("title") == title_of[ev_m["id"]]]
        assert months, "monthly should produce rows"
        rr_m = months[0].get("recurrence_rule") or {}
        assert rr_m.get("frequency") == "monthly", f"expected monthly rule, got {rr_m}"

    def test_import_all_and_reimport_all_skipped(self, coach_tok, parent_tok):
        r1 = requests.post(f"{API}/team/calendar/import-all-to-personal",
                           headers=_hdr(parent_tok), json={}, timeout=45)
        assert r1.status_code == 200, r1.text
        b1 = r1.json()
        assert b1["ok"] is True and "imported" in b1 and "skipped" in b1
        r2 = requests.post(f"{API}/team/calendar/import-all-to-personal",
                           headers=_hdr(parent_tok), json={}, timeout=45)
        b2 = r2.json()
        # After 1st import-all, 2nd call should skip everything
        assert b2["imported"] == 0, f"re-import expected 0 imported, got {b2}"
        assert b2["skipped"] >= b1["imported"] + b1["skipped"], f"skipped should cover all events, got {b2}"


# ------------- Cleanup -------------

@pytest.fixture(scope="module", autouse=True)
def _cleanup(request, parent_tok, coach_tok):
    yield
    # Delete imported schedule rows for parent
    try:
        sched = requests.get(f"{API}/schedule", headers=_hdr(parent_tok), timeout=30).json()
        events = sched if isinstance(sched, list) else sched.get("events", [])
        for e in events:
            if e.get("title", "").startswith("TEST_iter109"):
                sid = e.get("id")
                if sid:
                    requests.delete(f"{API}/schedule/{sid}", headers=_hdr(parent_tok), timeout=15)
    except Exception as ex:
        print(f"schedule cleanup failed: {ex}")
    # Delete team events
    for eid in _created_team_events:
        try:
            requests.delete(f"{API}/team/calendar/events/{eid}", headers=_hdr(coach_tok), timeout=15)
        except Exception:
            pass
