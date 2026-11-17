# Team-scoped payment trackers (optional team_ids on trackers)
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL").rstrip("/")
TEAM_ID = "7a5a0fa4-60c8-4d11-a17b-0f77f6ba1d11"  # Senior Elite Coed 5 (demo)
CREATED = []


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@cheerplanner.app", "password": "CheerDemo2026!"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    tok = r.json().get("token") or r.json().get("access_token")
    sess.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    yield sess
    for tid in CREATED:
        sess.delete(f"{BASE_URL}/api/team/payments/{tid}")


@pytest.fixture(scope="module")
def roster_counts(s):
    r = s.get(f"{BASE_URL}/api/roster")
    assert r.status_code == 200
    non_parent = [m for m in r.json() if m.get("role") != "parent"]
    on_team = [m for m in non_parent if TEAM_ID in (m.get("team_ids") or [])]
    off_team = [m for m in non_parent if TEAM_ID not in (m.get("team_ids") or [])]
    return {"all": len(non_parent), "team": len(on_team), "on": on_team, "off": off_team}


@pytest.fixture(scope="module")
def tracker(s):
    r = s.post(f"{BASE_URL}/api/team/payments", json={"name": "TEST_TeamTracker", "amount": 20, "team_ids": [TEAM_ID]})
    assert r.status_code == 200, r.text
    d = r.json()
    CREATED.append(d["id"])
    assert d["team_ids"] == [TEAM_ID]
    return d


class TestTeamScopedTracker:
    def test_roster_shape(self, roster_counts):
        print("roster counts", roster_counts["all"], roster_counts["team"])
        assert roster_counts["team"] > 0

    def test_get_summary_team_scoped(self, s, tracker, roster_counts):
        r = s.get(f"{BASE_URL}/api/team/payments/{tracker['id']}")
        assert r.status_code == 200
        sm = r.json()["summary"]
        assert sm["member_total"] == roster_counts["team"]
        assert sm["outstanding"] == 20 * roster_counts["team"]
        assert r.json()["team_ids"] == [TEAM_ID]

    def test_list_filter_by_team(self, s, tracker):
        r = s.get(f"{BASE_URL}/api/team/payments", params={"team_id": TEAM_ID})
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert tracker["id"] in ids
        # team's trackers + whole-roster trackers (which include the team)
        assert all(not t.get("team_ids") or TEAM_ID in t["team_ids"] for t in r.json())
        row = next(t for t in r.json() if t["id"] == tracker["id"])
        assert row["summary"]["member_total"] > 0

    def test_list_filter_other_team_excludes(self, s, tracker):
        r = s.get(f"{BASE_URL}/api/team/payments", params={"team_id": "nonexistent-team"})
        assert r.status_code == 200
        assert tracker["id"] not in [t["id"] for t in r.json()]

    def test_unfiltered_list_includes(self, s, tracker, roster_counts):
        r = s.get(f"{BASE_URL}/api/team/payments")
        row = next(t for t in r.json() if t["id"] == tracker["id"])
        assert row["summary"]["member_total"] == roster_counts["team"]

    def test_member_status_team_scoped(self, s, tracker, roster_counts):
        m = roster_counts["on"][0]
        r = s.put(f"{BASE_URL}/api/team/payments/{tracker['id']}/member/{m['id']}", json={"paid": True})
        assert r.status_code == 200, r.text
        sm = r.json()["summary"]
        assert sm["member_total"] == roster_counts["team"]
        assert sm["paid_count"] == 1
        assert sm["outstanding"] == 20 * (roster_counts["team"] - 1)

    def test_exclude_team_scoped(self, s, tracker, roster_counts):
        m = roster_counts["on"][1] if len(roster_counts["on"]) > 1 else roster_counts["on"][0]
        r = s.put(f"{BASE_URL}/api/team/payments/{tracker['id']}/member/{m['id']}/exclude", json={"excluded": True})
        assert r.status_code == 200
        sm = r.json()["summary"]
        assert sm["member_total"] == roster_counts["team"] - 1
        assert sm["excluded_count"] == 1
        r = s.put(f"{BASE_URL}/api/team/payments/{tracker['id']}/member/{m['id']}/exclude", json={"excluded": False})
        assert r.json()["summary"]["member_total"] == roster_counts["team"]

    def test_exclude_off_team_member_not_counted(self, s, tracker, roster_counts):
        if not roster_counts["off"]:
            pytest.skip("no off-team members")
        m = roster_counts["off"][0]
        # off-team people can't be recorded/excluded on a team tracker
        r = s.put(f"{BASE_URL}/api/team/payments/{tracker['id']}/member/{m['id']}/exclude", json={"excluded": True})
        assert r.status_code == 400
        r = s.put(f"{BASE_URL}/api/team/payments/{tracker['id']}/member/{m['id']}", json={"paid": True})
        assert r.status_code == 400

    def test_duplicate_keeps_team_ids(self, s, tracker, roster_counts):
        r = s.post(f"{BASE_URL}/api/team/payments/{tracker['id']}/duplicate")
        assert r.status_code == 200
        d = r.json()
        CREATED.append(d["id"])
        assert d["team_ids"] == [TEAM_ID]
        assert d["summary"]["member_total"] == roster_counts["team"]
        g = s.get(f"{BASE_URL}/api/team/payments/{d['id']}")
        assert g.json()["team_ids"] == [TEAM_ID]

    def test_remind_no_crash(self, s, tracker):
        r = s.post(f"{BASE_URL}/api/team/payments/{tracker['id']}/remind", json={})
        print("remind", r.status_code, r.text[:300])
        assert r.status_code in (200, 400, 402, 403)
        if r.status_code == 200:
            assert "sent" in r.json()

    def test_patch_clear_team_ids_whole_roster(self, s, tracker, roster_counts):
        r = s.patch(f"{BASE_URL}/api/team/payments/{tracker['id']}", json={"team_ids": []})
        assert r.status_code == 200
        assert r.json()["team_ids"] == []
        g = s.get(f"{BASE_URL}/api/team/payments/{tracker['id']}")
        assert g.json()["summary"]["member_total"] == roster_counts["all"]

    def test_patch_set_team_ids_again(self, s, tracker, roster_counts):
        r = s.patch(f"{BASE_URL}/api/team/payments/{tracker['id']}", json={"team_ids": [TEAM_ID]})
        assert r.status_code == 200
        g = s.get(f"{BASE_URL}/api/team/payments/{tracker['id']}")
        assert g.json()["summary"]["member_total"] == roster_counts["team"]

    def test_patch_team_ids_null(self, s, roster_counts):
        r = s.post(f"{BASE_URL}/api/team/payments", json={"name": "TEST_NullTeam", "team_ids": [TEAM_ID]})
        tid = r.json()["id"]
        CREATED.append(tid)
        r = s.patch(f"{BASE_URL}/api/team/payments/{tid}", json={"team_ids": None})
        print("patch null", r.status_code, r.text[:200])
        g = s.get(f"{BASE_URL}/api/team/payments/{tid}")
        print("get after null", g.status_code, g.text[:200])
        assert r.status_code in (200, 400, 422)
        assert g.status_code == 200

    def test_create_without_team_whole_roster(self, s, roster_counts):
        r = s.post(f"{BASE_URL}/api/team/payments", json={"name": "TEST_NoTeam", "amount": 10})
        assert r.status_code == 200
        d = r.json()
        CREATED.append(d["id"])
        assert d["team_ids"] == []
        g = s.get(f"{BASE_URL}/api/team/payments/{d['id']}")
        assert g.json()["summary"]["member_total"] == roster_counts["all"]
        assert g.json()["summary"]["outstanding"] == 10 * roster_counts["all"]
