"""Backend tests for iter76: Seasons CRUD/rollover/scoped edit + signup remind-claimed."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def auth():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def state():
    return {}


# --- SEASONS: CRUD ---
class TestSeasonsCRUD:
    def test_1_create_season_a(self, auth, state):
        # Snapshot any pre-existing seasons to restore state at teardown
        pre = auth.get(f"{BASE_URL}/api/seasons").json()
        state["pre_active_id"] = next((s["id"] for s in pre if s.get("is_active")), None)
        state["created_ids"] = []

        r = auth.post(f"{BASE_URL}/api/seasons", json={"name": "TEST_S1_2024-2025"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "TEST_S1_2024-2025"
        # If there were no prior seasons at all, this should auto-activate.
        state["s1_id"] = d["id"]
        state["s1_auto_active"] = d["is_active"]
        state["created_ids"].append(d["id"])

    def test_2_create_season_b(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/seasons", json={"name": "TEST_S2_2025-2026", "make_active": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_active"] is True
        state["s2_id"] = d["id"]
        state["created_ids"].append(d["id"])

    def test_3_only_one_active(self, auth, state):
        r = auth.get(f"{BASE_URL}/api/seasons")
        assert r.status_code == 200
        seasons = r.json()
        actives = [s for s in seasons if s["is_active"]]
        assert len(actives) == 1, f"expected exactly 1 active, got {len(actives)}"
        assert actives[0]["id"] == state["s2_id"]

    def test_4_activate_endpoint(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/seasons/{state['s1_id']}/activate")
        assert r.status_code == 200
        assert r.json()["is_active"] is True
        seasons = auth.get(f"{BASE_URL}/api/seasons").json()
        actives = [s for s in seasons if s["is_active"]]
        assert len(actives) == 1
        assert actives[0]["id"] == state["s1_id"]

    def test_5_patch_season(self, auth, state):
        r = auth.patch(f"{BASE_URL}/api/seasons/{state['s1_id']}",
                       json={"name": "TEST_S1_renamed", "start_date": "2024-08-01"})
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "TEST_S1_renamed"
        assert d["start_date"] == "2024-08-01"

    def test_6_patch_blank_name_rejected(self, auth, state):
        r = auth.patch(f"{BASE_URL}/api/seasons/{state['s1_id']}", json={"name": "   "})
        assert r.status_code == 400

    def test_7_patch_empty_body_rejected(self, auth, state):
        r = auth.patch(f"{BASE_URL}/api/seasons/{state['s1_id']}", json={})
        assert r.status_code == 400

    def test_8_create_blank_name_rejected(self, auth):
        r = auth.post(f"{BASE_URL}/api/seasons", json={"name": "  "})
        assert r.status_code == 400


# --- SEASONS: rollover + filtering ---
class TestSeasonsRolloverAndFilter:
    def test_1_seed_athlete_in_s1(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/athletes",
                      json={"name": "TEST_S_Athlete", "season_ids": [state["s1_id"]]})
        assert r.status_code == 200, r.text
        state["athlete_id"] = r.json()["id"]
        assert state["s1_id"] in r.json()["season_ids"]

    def test_2_seed_unassigned_athlete(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/athletes", json={"name": "TEST_S_Unassigned"})
        assert r.status_code == 200
        state["unassigned_id"] = r.json()["id"]
        assert r.json().get("season_ids", []) == []

    def test_3_filter_by_s1_includes_unassigned(self, auth, state):
        r = auth.get(f"{BASE_URL}/api/athletes?season_id={state['s1_id']}")
        assert r.status_code == 200
        ids = {a["id"] for a in r.json()}
        assert state["athlete_id"] in ids
        assert state["unassigned_id"] in ids, "unassigned athlete must be visible in every filtered view"

    def test_4_filter_by_s2_excludes_s1_only(self, auth, state):
        r = auth.get(f"{BASE_URL}/api/athletes?season_id={state['s2_id']}")
        assert r.status_code == 200
        ids = {a["id"] for a in r.json()}
        assert state["athlete_id"] not in ids, "athlete only in S1 should NOT show under S2 pre-rollover"
        assert state["unassigned_id"] in ids

    def test_5_rollover_s1_into_s2(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/seasons/{state['s1_id']}/rollover",
                      json={"target_season_id": state["s2_id"], "kinds": ["athletes"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["rolled_over"].get("athletes", 0) >= 1

    def test_6_after_rollover_athlete_in_both(self, auth, state):
        r = auth.get(f"{BASE_URL}/api/athletes?season_id={state['s2_id']}")
        assert r.status_code == 200
        found = next((a for a in r.json() if a["id"] == state["athlete_id"]), None)
        assert found is not None, "athlete should be visible in S2 after rollover"
        assert state["s1_id"] in found["season_ids"]
        assert state["s2_id"] in found["season_ids"]

    def test_7_rollover_same_season_rejected(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/seasons/{state['s1_id']}/rollover",
                      json={"target_season_id": state["s1_id"], "kinds": ["athletes"]})
        assert r.status_code == 400


# --- SEASONS: scoped edit fork ---
class TestScopedEdit:
    def test_1_ensure_active_is_s2(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/seasons/{state['s2_id']}/activate")
        assert r.status_code == 200

    def test_2_edit_scope_this_forks(self, auth, state):
        # athlete belongs to S1 + S2 (from rollover). Active is S2. edit_scope=this
        # should fork a new athlete in S2 and remove S2 from the original.
        r = auth.patch(f"{BASE_URL}/api/athletes/{state['athlete_id']}",
                       json={"name": "TEST_S_Athlete_S2fork", "edit_scope": "this"})
        assert r.status_code == 200, r.text
        forked = r.json()
        assert forked["id"] != state["athlete_id"], "fork should have a new id"
        assert forked["name"] == "TEST_S_Athlete_S2fork"
        assert state["s2_id"] in forked["season_ids"]
        assert state["s1_id"] not in forked["season_ids"], "fork must own only the active season"
        state["fork_id"] = forked["id"]

        # Original should still exist in S1 only
        r2 = auth.get(f"{BASE_URL}/api/athletes?season_id={state['s1_id']}")
        assert r2.status_code == 200
        orig = next((a for a in r2.json() if a["id"] == state["athlete_id"]), None)
        assert orig is not None
        assert state["s2_id"] not in orig["season_ids"]
        assert orig["name"] == "TEST_S_Athlete", "original name preserved (only fork got the rename)"

    def test_3_edit_scope_all_updates_in_place(self, auth, state):
        r = auth.patch(f"{BASE_URL}/api/athletes/{state['fork_id']}",
                       json={"gym": "TEST_Gym", "edit_scope": "all"})
        assert r.status_code == 200
        assert r.json()["id"] == state["fork_id"]
        assert r.json()["gym"] == "TEST_Gym"


# --- SEASONS: delete ---
class TestSeasonsDelete:
    def test_1_delete_active_promotes_another(self, auth, state):
        # Delete S2 (currently active) → S1 should be promoted, entities detached from S2.
        r = auth.delete(f"{BASE_URL}/api/seasons/{state['s2_id']}")
        assert r.status_code == 200
        seasons = auth.get(f"{BASE_URL}/api/seasons").json()
        # If S1 is the only remaining test season (or lowest order), it should be active
        assert any(s["is_active"] for s in seasons), "some season must be active after delete"

        # Confirm S2 detached from the fork athlete
        fork = auth.get(f"{BASE_URL}/api/athletes").json()
        f = next((a for a in fork if a["id"] == state["fork_id"]), None)
        if f is not None:
            assert state["s2_id"] not in f["season_ids"]
        state["created_ids"].remove(state["s2_id"])

    def test_2_delete_s1_cleanup(self, auth, state):
        r = auth.delete(f"{BASE_URL}/api/seasons/{state['s1_id']}")
        assert r.status_code == 200
        state["created_ids"].remove(state["s1_id"])

    def test_3_delete_404(self, auth):
        r = auth.delete(f"{BASE_URL}/api/seasons/does-not-exist-123")
        assert r.status_code == 404


# --- SIGNUP remind-claimed ---
class TestRemindClaimed:
    def test_1_ensure_premium(self, auth, state):
        # remind-claimed requires premium. Toggle admin self-premium if we're admin;
        # otherwise skip.
        me = auth.get(f"{BASE_URL}/api/auth/me")
        if me.status_code != 200:
            pytest.skip("auth/me not available")
        u = me.json()
        state["me"] = u
        if not u.get("is_admin"):
            # try to enable via /api/premium/self-toggle (admin only) — will 403 if not admin
            r = auth.post(f"{BASE_URL}/api/admin/self-premium", json={"enabled": True})
            if r.status_code != 200:
                # Try alternate endpoint
                r = auth.post(f"{BASE_URL}/api/premium/self-toggle", json={"enabled": True})
        # verify premium status
        ps = auth.get(f"{BASE_URL}/api/premium/status")
        if ps.status_code == 200 and not ps.json().get("is_premium"):
            pytest.skip("Test account is not Premium; remind-claimed requires premium.")

    def test_2_create_signup_and_slot(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/team/signups",
                      json={"name": "TEST_SU_iter76"})
        assert r.status_code == 200, r.text
        state["sheet_id"] = r.json()["id"]

        r2 = auth.post(f"{BASE_URL}/api/team/signups/{state['sheet_id']}/slots",
                       json={"label": "TEST_Water", "kind": "item", "qty_needed": 3})
        assert r2.status_code == 200
        state["slot_id"] = r2.json()["slots"][0]["id"]

    def test_3_create_roster_and_claim(self, auth, state):
        # Add a roster member with a magic Twilio number that succeeds
        r = auth.post(f"{BASE_URL}/api/roster",
                      json={"name": "TEST_Signer", "role": "coach", "phone": "+15005550006"})
        assert r.status_code == 200, r.text
        state["member_id"] = r.json()["id"]

        r2 = auth.post(f"{BASE_URL}/api/team/signups/{state['sheet_id']}/slots/{state['slot_id']}/claims",
                       json={"member_id": state["member_id"], "qty": 2})
        assert r2.status_code == 200

    def test_4_remind_claimed(self, auth, state):
        r = auth.post(f"{BASE_URL}/api/team/signups/{state['sheet_id']}/remind-claimed")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "sent" in body and "no_phone" in body and "failed" in body
        assert body["sent"] >= 1, f"expected at least 1 sent, got: {body}"

    def test_5_original_remind_still_works(self, auth, state):
        # Regression: original remind (people NOT signed up yet) — with only one
        # roster member who did sign up, expected sent = 0 (no leftovers).
        # Add an un-signed athlete with a phone so we have someone to text.
        r = auth.post(f"{BASE_URL}/api/roster",
                      json={"name": "TEST_NotSigned", "role": "coach", "phone": "+15005550006"})
        assert r.status_code == 200
        state["unsigned_id"] = r.json()["id"]
        rr = auth.post(f"{BASE_URL}/api/team/signups/{state['sheet_id']}/remind")
        assert rr.status_code == 200, rr.text
        assert rr.json()["sent"] >= 1

    def test_6_cleanup(self, auth, state):
        # Delete roster members
        for mid in [state.get("member_id"), state.get("unsigned_id")]:
            if mid:
                auth.delete(f"{BASE_URL}/api/roster/{mid}")
        # Delete signup sheet
        if state.get("sheet_id"):
            auth.delete(f"{BASE_URL}/api/team/signups/{state['sheet_id']}")


# --- Regression: unfiltered lists still work ---
class TestRegressionListing:
    def test_1_athletes_no_filter(self, auth):
        r = auth.get(f"{BASE_URL}/api/athletes")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_2_competitions_no_filter(self, auth):
        r = auth.get(f"{BASE_URL}/api/competitions")
        assert r.status_code == 200

    def test_3_teams_no_filter(self, auth):
        r = auth.get(f"{BASE_URL}/api/teams")
        assert r.status_code == 200

    def test_4_schedule_no_filter(self, auth):
        r = auth.get(f"{BASE_URL}/api/schedule")
        assert r.status_code == 200


# --- Cleanup any leftover TEST_ data ---
def test_zz_final_cleanup(auth, state):
    # Delete test athletes
    for key in ["athlete_id", "unassigned_id", "fork_id"]:
        aid = state.get(key)
        if aid:
            auth.delete(f"{BASE_URL}/api/athletes/{aid}")
    # Delete any remaining test seasons (in case earlier deletes were skipped)
    seasons = auth.get(f"{BASE_URL}/api/seasons").json()
    for s in seasons:
        if s.get("name", "").startswith("TEST_"):
            auth.delete(f"{BASE_URL}/api/seasons/{s['id']}")
    # Restore previous active season
    if state.get("pre_active_id"):
        auth.post(f"{BASE_URL}/api/seasons/{state['pre_active_id']}/activate")
