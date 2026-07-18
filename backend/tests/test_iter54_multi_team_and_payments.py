"""Backend tests for CheerPlanner iter 54 additions:

- Roster: multi-team support (team_ids list), team_id filter (incl. "none"),
  legacy team_id migration on read, import carries full team_ids list,
  list is sorted by last_name then first_name.
- Team Payment Tracking: per-member amount_paid + method + paid_at,
  summary.collected sums per-person amounts (falling back to tracker.amount),
  member_total excludes role='parent' roster docs.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com"
).rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


# ---- Auth fixture ---------------------------------------------------------
@pytest.fixture(scope="module")
def headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# Track ids we create so teardown removes them.
_created = {"roster": [], "trackers": [], "teams": []}


@pytest.fixture(scope="module", autouse=True)
def _cleanup(headers):
    yield
    for tid in _created["trackers"]:
        try:
            requests.delete(f"{BASE_URL}/api/team/payments/{tid}", headers=headers, timeout=10)
        except Exception:
            pass
    for mid in _created["roster"]:
        try:
            requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=headers, timeout=10)
        except Exception:
            pass
    for tid in _created["teams"]:
        try:
            requests.delete(f"{BASE_URL}/api/teams/{tid}", headers=headers, timeout=10)
        except Exception:
            pass
    # sweep any TEST_ leftovers
    try:
        r = requests.get(f"{BASE_URL}/api/roster", headers=headers, timeout=10)
        if r.status_code == 200:
            for m in r.json():
                if (m.get("name") or "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/roster/{m['id']}", headers=headers, timeout=10)
    except Exception:
        pass


def _mk_team(headers, name):
    r = requests.post(f"{BASE_URL}/api/teams", headers=headers, json={"name": name}, timeout=15)
    assert r.status_code in (200, 201), r.text
    t = r.json()
    _created["teams"].append(t["id"])
    return t


def _mk_member(headers, **overrides):
    body = {"name": "TEST_M", "role": "coach", "team_ids": []}
    body.update(overrides)
    r = requests.post(f"{BASE_URL}/api/roster", headers=headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    m = r.json()
    _created["roster"].append(m["id"])
    return m


# ---- Roster multi-team ----------------------------------------------------
class TestRosterMultiTeam:
    def test_team_ids_persisted_as_list(self, headers):
        t1 = _mk_team(headers, "TEST_TeamA")
        t2 = _mk_team(headers, "TEST_TeamB")
        m = _mk_member(
            headers,
            name="TEST_Zoe Alpha",
            first_name="Zoe",
            last_name="Alpha",
            role="coach",
            team_ids=[t1["id"], t2["id"]],
        )
        assert isinstance(m["team_ids"], list)
        assert set(m["team_ids"]) == {t1["id"], t2["id"]}

        # GET verifies persistence
        r = requests.get(f"{BASE_URL}/api/roster", headers=headers, timeout=15)
        assert r.status_code == 200
        found = next((x for x in r.json() if x["id"] == m["id"]), None)
        assert found is not None
        assert set(found["team_ids"]) == {t1["id"], t2["id"]}

    def test_filter_by_team_id_and_none(self, headers):
        t1 = _mk_team(headers, "TEST_FilterTeam")
        member_on_team = _mk_member(
            headers, name="TEST_OnTeam", first_name="On", last_name="Team",
            role="staff", team_ids=[t1["id"]],
        )
        member_no_team = _mk_member(
            headers, name="TEST_NoTeam", first_name="No", last_name="Team",
            role="staff", team_ids=[],
        )

        # Filter by specific team - member on team appears, member with no team does not
        r = requests.get(f"{BASE_URL}/api/roster", headers=headers, params={"team_id": t1["id"]}, timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert member_on_team["id"] in ids
        assert member_no_team["id"] not in ids

        # Filter team_id=none returns members with empty team_ids
        r = requests.get(f"{BASE_URL}/api/roster", headers=headers, params={"team_id": "none"}, timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert member_no_team["id"] in ids
        assert member_on_team["id"] not in ids

    def test_list_sorted_last_then_first(self, headers):
        # Create 3 with the same last name and different first names
        a = _mk_member(headers, name="TEST_A Zulu", first_name="Zulu", last_name="TEST_ZZLast", role="staff")
        b = _mk_member(headers, name="TEST_B Alpha", first_name="Alpha", last_name="TEST_ZZLast", role="staff")
        c = _mk_member(headers, name="TEST_C Mike", first_name="Mike", last_name="TEST_ZZLast", role="staff")
        r = requests.get(f"{BASE_URL}/api/roster", headers=headers, timeout=15)
        docs = [x for x in r.json() if x.get("last_name") == "TEST_ZZLast"]
        order = [x["first_name"] for x in docs]
        assert order == ["Alpha", "Mike", "Zulu"], order
        _ = (a, b, c)  # keep refs for cleanup


# ---- Roster import (carries team_ids) -------------------------------------
class TestRosterImportTeams:
    def test_import_athlete_carries_team_ids(self, headers):
        # Create a team and a household athlete on that team, then import
        t = _mk_team(headers, "TEST_ImportTeam")
        ath = requests.post(
            f"{BASE_URL}/api/athletes", headers=headers,
            json={"name": "TEST_ImportAthlete", "role": "athlete", "team_ids": [t["id"]]},
            timeout=15,
        )
        assert ath.status_code == 200, ath.text
        athlete = ath.json()
        try:
            r = requests.post(
                f"{BASE_URL}/api/roster/import", headers=headers,
                json={"athlete_ids": [athlete["id"]], "member_user_ids": []},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            created = r.json()
            assert len(created) == 1
            m = created[0]
            _created["roster"].append(m["id"])
            assert m["source"] == "athlete"
            assert m["linked_id"] == athlete["id"]
            assert t["id"] in (m.get("team_ids") or [])
        finally:
            requests.delete(f"{BASE_URL}/api/athletes/{athlete['id']}", headers=headers, timeout=10)


# ---- Payment tracker semantics --------------------------------------------
class TestPaymentTrackerBehavior:
    def test_create_list_summary_and_variable_amounts(self, headers):
        # 1) create members (all non-parent so they count in member_total)
        m1 = _mk_member(headers, name="TEST_PayA", first_name="A", last_name="TEST_PayLast", role="athlete")
        m2 = _mk_member(headers, name="TEST_PayB", first_name="B", last_name="TEST_PayLast", role="staff")

        # 2) create tracker with default expected amount 25
        r = requests.post(
            f"{BASE_URL}/api/team/payments", headers=headers,
            json={"name": "TEST_Tracker", "amount": 25, "note": "n"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        tr = r.json()
        _created["trackers"].append(tr["id"])
        assert tr["name"] == "TEST_Tracker"
        assert tr["amount"] == 25

        # 3) list and confirm summary shape
        r = requests.get(f"{BASE_URL}/api/team/payments", headers=headers, timeout=15)
        assert r.status_code == 200
        got = next((x for x in r.json() if x["id"] == tr["id"]), None)
        assert got is not None
        assert "summary" in got
        assert got["summary"]["paid_count"] == 0
        assert got["summary"]["collected"] == 0

        # 4) mark m1 paid with amount 40, method Venmo, paid_at 2026-01-05
        r = requests.put(
            f"{BASE_URL}/api/team/payments/{tr['id']}/member/{m1['id']}",
            headers=headers,
            json={"paid": True, "amount_paid": 40, "method": "Venmo", "paid_at": "2026-01-05", "note": "half"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        got = r.json()
        e1 = next(e for e in got["entries"] if e["member_id"] == m1["id"])
        assert e1["paid"] is True
        assert e1["amount_paid"] == 40
        assert e1["method"] == "Venmo"
        assert e1["paid_at"] == "2026-01-05"

        # 5) mark m2 paid WITHOUT amount_paid → should fall back to tracker.amount (25) in summary
        r = requests.put(
            f"{BASE_URL}/api/team/payments/{tr['id']}/member/{m2['id']}",
            headers=headers,
            json={"paid": True, "method": "Cash"},
            timeout=15,
        )
        assert r.status_code == 200
        got = r.json()
        # summary.collected = 40 (m1) + 25 (m2 fallback) = 65
        assert got["summary"]["paid_count"] == 2
        assert got["summary"]["collected"] == 65.0

        # 6) mark m2 unpaid → clears method and paid_at
        r = requests.put(
            f"{BASE_URL}/api/team/payments/{tr['id']}/member/{m2['id']}",
            headers=headers, json={"paid": False}, timeout=15,
        )
        assert r.status_code == 200
        got = r.json()
        e2 = next(e for e in got["entries"] if e["member_id"] == m2["id"])
        assert e2["paid"] is False
        assert e2["paid_at"] is None
        assert e2["method"] is None
        assert got["summary"]["paid_count"] == 1
        assert got["summary"]["collected"] == 40.0

    def test_member_total_excludes_parents(self, headers):
        # Add a parent — should NOT be counted in member_total.
        p = _mk_member(headers, name="TEST_ParentX", first_name="Par", last_name="Ent", role="parent")
        r = requests.post(
            f"{BASE_URL}/api/team/payments", headers=headers,
            json={"name": "TEST_ParentExcl", "amount": 10},
            timeout=15,
        )
        assert r.status_code == 200
        tr = r.json()
        _created["trackers"].append(tr["id"])
        r = requests.get(f"{BASE_URL}/api/team/payments/{tr['id']}", headers=headers, timeout=15)
        assert r.status_code == 200
        # member_total should equal non-parent roster count.
        rr = requests.get(f"{BASE_URL}/api/roster", headers=headers, timeout=15)
        expected_total = sum(1 for x in rr.json() if x.get("role") != "parent")
        assert r.json()["summary"]["member_total"] == expected_total
        _ = p

    def test_patch_and_delete_tracker(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/team/payments", headers=headers,
            json={"name": "TEST_ToEdit", "amount": 5}, timeout=15,
        )
        assert r.status_code == 200
        tr = r.json()
        _created["trackers"].append(tr["id"])
        # PATCH
        r = requests.patch(
            f"{BASE_URL}/api/team/payments/{tr['id']}", headers=headers,
            json={"name": "TEST_Edited", "amount": 12}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Edited"
        assert r.json()["amount"] == 12
        # DELETE + 404 next time
        r = requests.delete(f"{BASE_URL}/api/team/payments/{tr['id']}", headers=headers, timeout=15)
        assert r.status_code == 200
        _created["trackers"].remove(tr["id"])
        r = requests.delete(f"{BASE_URL}/api/team/payments/{tr['id']}", headers=headers, timeout=15)
        assert r.status_code == 404
