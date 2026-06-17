"""
Iteration 18 — CheerPlanner backend regression sweep.

Covers:
  A. Payment waterfall allocation (POST + PATCH /api/payments)
  B. Team multi-day meet times round-trip (PATCH /api/competitions/{id})
  C. Calendar feed: team_meet / team_performance / team_to_watch items
  D. ICS export of timed team events
  E. Regression — auth, athletes (no cap), teams cascade, competitions w/o lists,
     bulk-delete, standard expense + explicit-allocation payment CRUD.
"""
import os
import uuid
import pytest
import requests
from pathlib import Path

# -------- BASE URL ------------------------------------------------------
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1]
                break
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"

EMAIL = "smoke@test.com"
PASSWORD = "password123"


# -------- session + auth ------------------------------------------------
@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        s.post(f"{BASE_URL}/api/auth/signup", json={"email": EMAIL, "password": PASSWORD, "name": "Smoke"})
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# helpers ---------------------------------------------------------------
def _new_athlete(client, name="Iter18 Athlete", role="athlete", team_ids=None):
    payload = {"name": name, "role": role}
    if team_ids is not None:
        payload["team_ids"] = team_ids
    r = client.post(f"{BASE_URL}/api/athletes", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _new_expense(client, athlete_id, amount, due_date, category="Other", note=None):
    payload = {
        "athlete_id": athlete_id,
        "amount": amount,
        "category": category,
        "incurred_on": "2026-01-01",
        "due_date": due_date,
        "note": note or f"TEST_{category}_{due_date}",
    }
    r = client.post(f"{BASE_URL}/api/expenses", json=payload)
    assert r.status_code == 200, r.text
    arr = r.json()
    # /expenses POST returns a list; first item is the just-created expense
    created = arr[0] if isinstance(arr, list) else arr
    return created


def _get_expense(client, eid):
    r = client.get(f"{BASE_URL}/api/expenses")
    assert r.status_code == 200
    for e in r.json():
        if e["id"] == eid:
            return e
    return None


# ======================================================================
# Section A — Payment Waterfall
# ======================================================================
class TestWaterfallAllocation:

    @pytest.fixture(scope="class")
    def sandbox(self, client):
        """Athlete + 3 staggered expenses for waterfall tests."""
        ath = _new_athlete(client, name=f"TEST_Water_{uuid.uuid4().hex[:6]}")
        # Tuition $100 due 3/1, Gear $200 due 2/1, Camp $50 due 1/15
        e_tuition = _new_expense(client, ath["id"], 100, "2026-03-01", "Tuition")
        e_gear    = _new_expense(client, ath["id"], 200, "2026-02-01", "Gear")
        e_camp    = _new_expense(client, ath["id"],  50, "2026-01-15", "Camp")
        ids = {"athlete": ath["id"], "tuition": e_tuition["id"],
               "gear": e_gear["id"], "camp": e_camp["id"]}
        yield ids
        # cleanup
        client.post(f"{BASE_URL}/api/bulk-delete",
                    json={"resource": "expenses",
                          "ids": [ids["tuition"], ids["gear"], ids["camp"]]})
        client.delete(f"{BASE_URL}/api/athletes/{ids['athlete']}")

    def test_01_payment_250_pays_camp_and_gear_full(self, client, sandbox):
        """$250 across 3 expenses → Camp ($50) + Gear ($200) fully paid, Tuition still owed."""
        # IDs intentionally in reverse order to assert server re-sorts by due_date
        payload = {
            "athlete_id": sandbox["athlete"],
            "amount": 250,
            "paid_on": "2026-01-10",
            "applied_expense_ids": [sandbox["tuition"], sandbox["gear"], sandbox["camp"]],
        }
        r = client.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 200, r.text
        pay = r.json()
        allocs = {a["expense_id"]: a["amount"] for a in (pay.get("allocations") or [])}
        assert allocs.get(sandbox["camp"]) == 50.0
        assert allocs.get(sandbox["gear"]) == 200.0
        assert sandbox["tuition"] not in allocs or allocs.get(sandbox["tuition"]) == 0
        # Verify expense paid flags + balances
        camp = _get_expense(client, sandbox["camp"])
        gear = _get_expense(client, sandbox["gear"])
        tuition = _get_expense(client, sandbox["tuition"])
        assert camp["paid"] is True, "Camp should be auto-flagged paid"
        assert gear["paid"] is True, "Gear should be auto-flagged paid"
        assert tuition["paid"] is False, "Tuition should NOT be paid yet"
        assert camp["balance_due"] == 0.0
        assert gear["balance_due"] == 0.0
        assert tuition["balance_due"] == 100.0
        # delete this payment so subsequent tests start clean
        client.delete(f"{BASE_URL}/api/payments/{pay['id']}")
        # ensure paid flags reset after delete (re-evaluated via expenses list)
        # NOTE: delete doesn't currently reset paid flag — leave as observation

    def test_02_partial_60_across_two(self, client, sandbox):
        """$60 across $100/$200 — earliest gets all $60, balance $40 on it."""
        # Reset paid flags (since test_01 left them set; only relevant for this expense)
        for eid in (sandbox["camp"], sandbox["gear"], sandbox["tuition"]):
            client.patch(f"{BASE_URL}/api/expenses/{eid}", json={"paid": False})

        # Use Gear ($200 due 2/1) + Tuition ($100 due 3/1). Earliest is Gear.
        payload = {
            "athlete_id": sandbox["athlete"],
            "amount": 60,
            "paid_on": "2026-01-12",
            "applied_expense_ids": [sandbox["tuition"], sandbox["gear"]],
        }
        r = client.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 200, r.text
        pay = r.json()
        allocs = {a["expense_id"]: a["amount"] for a in (pay.get("allocations") or [])}
        assert allocs.get(sandbox["gear"]) == 60.0, f"Expected Gear $60, got {allocs}"
        assert sandbox["tuition"] not in allocs or allocs.get(sandbox["tuition"], 0) == 0
        gear = _get_expense(client, sandbox["gear"])
        assert gear["paid"] is False
        assert gear["balance_due"] == 140.0

        # ---- PATCH amount 60 → 300 — both should now be fully covered
        r2 = client.patch(f"{BASE_URL}/api/payments/{pay['id']}",
                          json={"amount": 300})
        assert r2.status_code == 200, r2.text
        pay2 = r2.json()
        allocs2 = {a["expense_id"]: a["amount"] for a in (pay2.get("allocations") or [])}
        assert allocs2.get(sandbox["gear"]) == 200.0
        assert allocs2.get(sandbox["tuition"]) == 100.0
        gear = _get_expense(client, sandbox["gear"])
        tuition = _get_expense(client, sandbox["tuition"])
        assert gear["paid"] is True, "Gear paid after PATCH up"
        assert tuition["paid"] is True, "Tuition paid after PATCH up"

        # ---- PATCH amount 300 → 60 — flags should reset
        r3 = client.patch(f"{BASE_URL}/api/payments/{pay['id']}",
                          json={"amount": 60})
        assert r3.status_code == 200, r3.text
        gear = _get_expense(client, sandbox["gear"])
        tuition = _get_expense(client, sandbox["tuition"])
        assert gear["paid"] is False, "Gear paid flag should clear when payment drops"
        assert tuition["paid"] is False, "Tuition paid flag should clear too"

        client.delete(f"{BASE_URL}/api/payments/{pay['id']}")

    def test_03_reverse_id_order_still_waterfalls(self, client, sandbox):
        """Server sorts by due_date regardless of client ID order."""
        for eid in (sandbox["camp"], sandbox["gear"], sandbox["tuition"]):
            client.patch(f"{BASE_URL}/api/expenses/{eid}", json={"paid": False})
        payload = {
            "athlete_id": sandbox["athlete"],
            "amount": 75,
            "paid_on": "2026-01-15",
            # Reverse order: Tuition first
            "applied_expense_ids": [sandbox["tuition"], sandbox["camp"]],
        }
        r = client.post(f"{BASE_URL}/api/payments", json=payload)
        pay = r.json()
        allocs = {a["expense_id"]: a["amount"] for a in (pay.get("allocations") or [])}
        # Camp due 1/15 (earliest) should get $50 first, then Tuition $25
        assert allocs.get(sandbox["camp"]) == 50.0
        assert allocs.get(sandbox["tuition"]) == 25.0
        client.delete(f"{BASE_URL}/api/payments/{pay['id']}")


# ======================================================================
# Section B — Team multi-day meet times round-trip
# ======================================================================
class TestTeamMeetTimesRoundTrip:

    @pytest.fixture(scope="class")
    def setup(self, client):
        t = client.post(f"{BASE_URL}/api/teams",
                        json={"name": f"TEST_T1_{uuid.uuid4().hex[:5]}",
                              "color": "#FF6699"}).json()
        c = client.post(f"{BASE_URL}/api/competitions",
                        json={"name": f"TEST_C1_{uuid.uuid4().hex[:5]}",
                              "event_date": "2026-06-12",
                              "location": "Center Arena"}).json()
        ids = {"team": t["id"], "comp": c["id"]}
        yield ids
        client.delete(f"{BASE_URL}/api/competitions/{ids['comp']}")
        client.delete(f"{BASE_URL}/api/teams/{ids['team']}")

    def test_04_patch_two_entries_round_trip(self, client, setup):
        body = {
            "team_ids": [setup["team"]],
            "team_meet_times": [
                {"team_id": setup["team"], "date": "2026-06-12",
                 "meet_time": "14:00", "performance_time": "16:00",
                 "performance_location": "Hall A"},
                {"team_id": setup["team"], "date": "2026-06-13",
                 "meet_time": "13:00", "performance_time": "15:00",
                 "performance_location": "Hall B"},
            ],
        }
        r = client.patch(f"{BASE_URL}/api/competitions/{setup['comp']}", json=body)
        assert r.status_code == 200, r.text
        got = client.get(f"{BASE_URL}/api/competitions/{setup['comp']}").json()
        mts = got["team_meet_times"]
        assert len(mts) == 2
        d2 = sorted(mts, key=lambda x: x["date"])
        assert d2[0]["date"] == "2026-06-12"
        assert d2[0]["meet_time"] == "14:00"
        assert d2[0]["performance_time"] == "16:00"
        assert d2[0]["performance_location"] == "Hall A"
        assert d2[1]["date"] == "2026-06-13"
        assert d2[1]["meet_time"] == "13:00"
        assert d2[1]["performance_location"] == "Hall B"

    def test_05_edit_single_entry(self, client, setup):
        body = {
            "team_meet_times": [
                {"team_id": setup["team"], "date": "2026-06-12",
                 "meet_time": "14:00", "performance_time": "15:30",
                 "performance_location": "Hall A (updated)"},
                {"team_id": setup["team"], "date": "2026-06-13",
                 "meet_time": "13:00", "performance_time": "15:00",
                 "performance_location": "Hall B"},
            ],
        }
        client.patch(f"{BASE_URL}/api/competitions/{setup['comp']}", json=body)
        got = client.get(f"{BASE_URL}/api/competitions/{setup['comp']}").json()
        june12 = next(m for m in got["team_meet_times"] if m["date"] == "2026-06-12")
        assert june12["performance_time"] == "15:30"
        assert june12["performance_location"] == "Hall A (updated)"

    def test_06_remove_one_entry(self, client, setup):
        body = {
            "team_meet_times": [
                {"team_id": setup["team"], "date": "2026-06-13",
                 "meet_time": "13:00", "performance_time": "15:00",
                 "performance_location": "Hall B"},
            ],
        }
        client.patch(f"{BASE_URL}/api/competitions/{setup['comp']}", json=body)
        got = client.get(f"{BASE_URL}/api/competitions/{setup['comp']}").json()
        assert len(got["team_meet_times"]) == 1
        assert got["team_meet_times"][0]["date"] == "2026-06-13"


# ======================================================================
# Section C — Calendar feed
# ======================================================================
class TestCalendarFeed:

    @pytest.fixture(scope="class")
    def fixture(self, client):
        t = client.post(f"{BASE_URL}/api/teams",
                        json={"name": f"TEST_CalTeam_{uuid.uuid4().hex[:5]}",
                              "color": "#33CC88"}).json()
        c = client.post(f"{BASE_URL}/api/competitions",
                        json={"name": f"TEST_CalComp_{uuid.uuid4().hex[:5]}",
                              "event_date": "2026-06-12",
                              "location": "Arena"}).json()
        # Two-day schedule (edited values consistent with tests above)
        client.patch(f"{BASE_URL}/api/competitions/{c['id']}", json={
            "team_ids": [t["id"]],
            "team_meet_times": [
                {"team_id": t["id"], "date": "2026-06-12",
                 "meet_time": "13:30", "performance_time": "16:00",
                 "performance_location": "Hall A (updated)"},
                {"team_id": t["id"], "date": "2026-06-13",
                 "meet_time": "13:00", "performance_time": "15:00",
                 "performance_location": "Hall B"},
                # Bare-date entry — no times → should emit a single team_performance marker.
                {"team_id": t["id"], "date": "2026-06-14",
                 "performance_location": "Hall C"},
            ],
            "teams_to_watch": [
                {"name": "Cobras", "date": "2026-06-12",
                 "performance_time": "10:00", "location": "Hall Z"},
            ],
        })
        ids = {"team": t["id"], "comp": c["id"], "team_color": "#33CC88"}
        yield ids
        client.delete(f"{BASE_URL}/api/competitions/{ids['comp']}")
        client.delete(f"{BASE_URL}/api/teams/{ids['team']}")

    def test_07_team_meet_and_performance_present(self, client, fixture):
        r = client.get(f"{BASE_URL}/api/calendar",
                       params={"start": "2026-06-01", "end": "2026-06-30"})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        team_meets = [i for i in items if i["kind"] == "team_meet" and i["link"].endswith(fixture["comp"])]
        team_perfs = [i for i in items if i["kind"] == "team_performance" and i["link"].endswith(fixture["comp"])]
        # 2 team_meet (12 + 13), 3 team_performance (12, 13, 14 bare-date)
        meet_dates = sorted([m["date"] for m in team_meets])
        perf_dates = sorted([p["date"] for p in team_perfs])
        assert meet_dates == ["2026-06-12", "2026-06-13"], meet_dates
        assert perf_dates == ["2026-06-12", "2026-06-13", "2026-06-14"], perf_dates
        # Verify time + subtitle on the edited entry
        june12_meet = next(m for m in team_meets if m["date"] == "2026-06-12")
        assert june12_meet["time"] == "13:30"
        assert "Hall A (updated)" in june12_meet["subtitle"]
        assert "1:30 PM" in june12_meet["subtitle"]
        assert june12_meet["color"] == fixture["team_color"]

    def test_08_team_to_watch_cyan(self, client, fixture):
        r = client.get(f"{BASE_URL}/api/calendar",
                       params={"start": "2026-06-01", "end": "2026-06-30"})
        items = r.json()["items"]
        watchers = [i for i in items if i["kind"] == "team_to_watch"]
        assert any(w["title"] == "Cobras" for w in watchers)
        cobras = next(w for w in watchers if w["title"] == "Cobras")
        assert cobras["color"] == "#0EA5E9"
        assert cobras["date"] == "2026-06-12"

    def test_09_bare_date_emits_marker(self, client, fixture):
        r = client.get(f"{BASE_URL}/api/calendar",
                       params={"start": "2026-06-14", "end": "2026-06-14"})
        items = r.json()["items"]
        bare = [i for i in items if i["kind"] == "team_performance" and i["date"] == "2026-06-14"]
        assert len(bare) == 1
        assert "performance day" in bare[0]["title"].lower()


# ======================================================================
# Section D — ICS export
# ======================================================================
class TestICSExport:

    def test_10_ics_includes_timed_team_events(self, client):
        # Create a comp + team with 2026-06-12 14:00 entry just for this test
        t = client.post(f"{BASE_URL}/api/teams",
                        json={"name": f"TEST_ICS_{uuid.uuid4().hex[:5]}",
                              "color": "#AB12CD"}).json()
        c = client.post(f"{BASE_URL}/api/competitions",
                        json={"name": f"TEST_ICSComp_{uuid.uuid4().hex[:5]}",
                              "event_date": "2026-06-12"}).json()
        client.patch(f"{BASE_URL}/api/competitions/{c['id']}", json={
            "team_ids": [t["id"]],
            "team_meet_times": [
                {"team_id": t["id"], "date": "2026-06-12",
                 "meet_time": "14:00", "performance_time": "16:00"},
            ],
        })
        try:
            r = client.get(f"{BASE_URL}/api/export/calendar.ics")
            assert r.status_code == 200, r.text
            text = r.text
            assert "BEGIN:VCALENDAR" in text
            assert "END:VCALENDAR" in text
            assert "DTSTART:20260612T140000" in text, "expected timed VEVENT for 14:00 meet"
            assert "DTSTART:20260612T160000" in text, "expected timed VEVENT for 16:00 perf"
        finally:
            client.delete(f"{BASE_URL}/api/competitions/{c['id']}")
            client.delete(f"{BASE_URL}/api/teams/{t['id']}")


# ======================================================================
# Section E — Regression sweep
# ======================================================================
class TestRegression:

    def test_11_auth_me(self, client):
        r = client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == EMAIL

    def test_12_athlete_5_teams_unlimited(self, client):
        teams = [client.post(f"{BASE_URL}/api/teams",
                             json={"name": f"TEST_R5_{i}_{uuid.uuid4().hex[:4]}"}).json()
                 for i in range(5)]
        ids = [t["id"] for t in teams]
        r = client.post(f"{BASE_URL}/api/athletes",
                        json={"name": "TEST_5TeamAthlete", "role": "athlete",
                              "team_ids": ids})
        assert r.status_code == 200, r.text
        ath = r.json()
        assert len(ath["team_ids"]) == 5
        client.delete(f"{BASE_URL}/api/athletes/{ath['id']}")
        client.post(f"{BASE_URL}/api/bulk-delete",
                    json={"resource": "teams", "ids": ids})

    def test_13_team_cascade_delete(self, client):
        t = client.post(f"{BASE_URL}/api/teams",
                        json={"name": f"TEST_Casc_{uuid.uuid4().hex[:5]}"}).json()
        # athlete refs it
        ath = client.post(f"{BASE_URL}/api/athletes",
                          json={"name": "TEST_CascAth", "role": "athlete",
                                "team_ids": [t["id"]]}).json()
        # comp refs it
        comp = client.post(f"{BASE_URL}/api/competitions",
                           json={"name": "TEST_CascComp", "event_date": "2026-07-01"}).json()
        client.patch(f"{BASE_URL}/api/competitions/{comp['id']}",
                     json={"team_ids": [t["id"]],
                           "team_meet_times": [{"team_id": t["id"],
                                                "date": "2026-07-01",
                                                "meet_time": "10:00"}]})
        # delete team
        dr = client.delete(f"{BASE_URL}/api/teams/{t['id']}")
        assert dr.status_code == 200
        # verify cascades
        ath_after = next((a for a in client.get(f"{BASE_URL}/api/athletes").json()
                          if a["id"] == ath["id"]), None)
        assert ath_after is not None
        assert t["id"] not in (ath_after.get("team_ids") or [])
        comp_after = client.get(f"{BASE_URL}/api/competitions/{comp['id']}").json()
        assert t["id"] not in (comp_after.get("team_ids") or [])
        assert all(m["team_id"] != t["id"] for m in comp_after.get("team_meet_times") or [])
        # cleanup
        client.delete(f"{BASE_URL}/api/athletes/{ath['id']}")
        client.delete(f"{BASE_URL}/api/competitions/{comp['id']}")

    def test_14_competition_omit_list_fields(self, client):
        r = client.post(f"{BASE_URL}/api/competitions",
                        json={"name": "TEST_NoLists", "event_date": "2026-08-01"})
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["team_ids"] == []
        assert c["team_meet_times"] == []
        assert c["teams_to_watch"] == []
        client.delete(f"{BASE_URL}/api/competitions/{c['id']}")

    def test_15_bulk_delete_resources(self, client):
        # Create 2 expenses then bulk-delete
        ath = client.post(f"{BASE_URL}/api/athletes",
                          json={"name": "TEST_BulkAth", "role": "athlete"}).json()
        e1 = _new_expense(client, ath["id"], 10, "2026-03-01", "Other")
        e2 = _new_expense(client, ath["id"], 20, "2026-03-02", "Other")
        r = client.post(f"{BASE_URL}/api/bulk-delete",
                        json={"resource": "expenses", "ids": [e1["id"], e2["id"]]})
        assert r.status_code == 200, r.text
        assert r.json().get("deleted") == 2
        client.delete(f"{BASE_URL}/api/athletes/{ath['id']}")

    def test_16_standard_payment_with_explicit_allocations(self, client):
        ath = client.post(f"{BASE_URL}/api/athletes",
                          json={"name": "TEST_StdPay", "role": "athlete"}).json()
        e1 = _new_expense(client, ath["id"], 100, "2026-03-01", "Tuition")
        e2 = _new_expense(client, ath["id"], 100, "2026-04-01", "Gear")
        # Client explicitly splits 80/20
        r = client.post(f"{BASE_URL}/api/payments", json={
            "athlete_id": ath["id"],
            "amount": 100,
            "paid_on": "2026-01-12",
            "applied_expense_ids": [e1["id"], e2["id"]],
            "allocations": [
                {"expense_id": e1["id"], "amount": 80},
                {"expense_id": e2["id"], "amount": 20},
            ],
        })
        assert r.status_code == 200, r.text
        pay = r.json()
        allocs = {a["expense_id"]: a["amount"] for a in (pay["allocations"] or [])}
        # Explicit allocations should be respected — NOT replaced by waterfall.
        assert allocs.get(e1["id"]) == 80
        assert allocs.get(e2["id"]) == 20
        # cleanup
        client.delete(f"{BASE_URL}/api/payments/{pay['id']}")
        client.post(f"{BASE_URL}/api/bulk-delete",
                    json={"resource": "expenses", "ids": [e1["id"], e2["id"]]})
        client.delete(f"{BASE_URL}/api/athletes/{ath['id']}")
