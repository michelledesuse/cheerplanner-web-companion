"""Iter96 Seasons Rework Phases 2-4 backend tests.

Focus: POST /api/seasons/rollover-create + dashboard suggest_season flag.
Uses the seeded applereview@cheerplanner.app account which already has two
seasons (2024-2025 past, 2025-2026 active).
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture()
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _seasons(headers):
    r = requests.get(f"{BASE_URL}/api/seasons", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _find(headers, name):
    return next((s for s in _seasons(headers) if s["name"] == name), None)


def _cleanup(headers, name):
    s = _find(headers, name)
    if s:
        requests.delete(f"{BASE_URL}/api/seasons/{s['id']}", headers=headers, timeout=30)


# --- Base auth + list --------------------------------------------------------

def test_login_and_two_seasons_present(headers):
    seasons = _seasons(headers)
    names = {s["name"] for s in seasons}
    # The seeded set may include either 2024-2025 or 2025-2026 in any variant.
    assert any("2024" in n and "2025" in n for n in names), f"missing past 2024-2025: {names}"
    assert any("2025" in n and "2026" in n for n in names), f"missing active 2025-2026: {names}"
    actives = [s for s in seasons if s["is_active"]]
    assert len(actives) == 1, f"exactly one active season expected, got {actives}"
    assert "2025" in actives[0]["name"] and "2026" in actives[0]["name"]


# --- rollover-create happy path ---------------------------------------------

class TestRolloverCreate:
    NEW_NAME = "TEST_2026-2027-rollover"

    def teardown_method(self):
        # Best-effort cleanup between tests
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
        h = {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}
        _cleanup(h, self.NEW_NAME)

    def test_rollover_creates_new_active_season_and_leaves_source_intact(self, headers):
        seasons = _seasons(headers)
        source = next(s for s in seasons if "2025" in s["name"] and "2026" in s["name"])  # active
        assert source["is_active"] is True

        # Snapshot of source: athletes tagged, teams tagged
        r_ath = requests.get(f"{BASE_URL}/api/athletes?season_id={source['id']}", headers=headers, timeout=30)
        assert r_ath.status_code == 200
        src_athletes_before = r_ath.json()
        r_teams = requests.get(f"{BASE_URL}/api/teams?season_id={source['id']}", headers=headers, timeout=30)
        # /api/teams may or may not accept season_id; fall back to full list filtered client-side
        if r_teams.status_code == 200:
            src_teams_before = r_teams.json()
        else:
            r_teams = requests.get(f"{BASE_URL}/api/teams", headers=headers, timeout=30)
            src_teams_before = [t for t in r_teams.json() if source["id"] in (t.get("season_ids") or [])]

        # Prep dates strictly after source end
        end = source["end_date"][:10]
        new_start = end  # note: our seed's next season starts day after, but we'll pick a safe far-future window
        # Use a non-overlapping window well in the future to avoid clashing with any other season
        payload = {
            "source_season_id": source["id"],
            "name": self.NEW_NAME,
            "start_date": "2030-06-01",
            "end_date": "2031-05-31",
            "carry_teams": True,
            "athlete_ids": [a["id"] for a in src_athletes_before[:2]],
        }
        r = requests.post(f"{BASE_URL}/api/seasons/rollover-create", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "season" in body and "summary" in body
        new_season = body["season"]
        assert new_season["name"] == self.NEW_NAME
        assert new_season["is_active"] is True
        assert body["summary"]["teams"] == len(src_teams_before)
        assert body["summary"]["athletes"] == len(payload["athlete_ids"])

        # Verify NEW season is now active and source is not
        seasons2 = _seasons(headers)
        active = [s for s in seasons2 if s["is_active"]]
        assert len(active) == 1 and active[0]["id"] == new_season["id"]

        # Verify SOURCE athletes/teams untouched (still tagged into source)
        r_ath2 = requests.get(f"{BASE_URL}/api/athletes?season_id={source['id']}", headers=headers, timeout=30)
        assert {a["id"] for a in r_ath2.json()} == {a["id"] for a in src_athletes_before}, "source athletes changed"

        # Verify carried athletes now also tagged into NEW season
        r_ath_new = requests.get(f"{BASE_URL}/api/athletes?season_id={new_season['id']}", headers=headers, timeout=30)
        carried_ids = {a["id"] for a in r_ath_new.json()}
        assert set(payload["athlete_ids"]).issubset(carried_ids), f"carried athletes missing: {carried_ids}"

        # Undo: delete new season → source intact
        r_del = requests.delete(f"{BASE_URL}/api/seasons/{new_season['id']}", headers=headers, timeout=30)
        assert r_del.status_code == 200, r_del.text
        r_ath3 = requests.get(f"{BASE_URL}/api/athletes?season_id={source['id']}", headers=headers, timeout=30)
        assert {a["id"] for a in r_ath3.json()} == {a["id"] for a in src_athletes_before}, "source athletes lost after undo"

    def test_rollover_duplicate_name_returns_409(self, headers):
        source = next(s for s in _seasons(headers) if s["is_active"])
        # Reuse the ACTIVE season name to force a duplicate 409
        payload = {
            "source_season_id": source["id"],
            "name": source["name"],
            "start_date": "2032-06-01",
            "end_date": "2033-05-31",
            "carry_teams": False,
            "athlete_ids": [],
        }
        r = requests.post(f"{BASE_URL}/api/seasons/rollover-create", headers=headers, json=payload, timeout=30)
        assert r.status_code == 409, f"expected 409 duplicate name, got {r.status_code}: {r.text}"

    def test_rollover_overlapping_dates_returns_409(self, headers):
        source = next(s for s in _seasons(headers) if s["is_active"])
        # Overlap with the source season itself
        payload = {
            "source_season_id": source["id"],
            "name": self.NEW_NAME,
            "start_date": source["start_date"][:10],
            "end_date": source["end_date"][:10],
            "carry_teams": False,
            "athlete_ids": [],
        }
        r = requests.post(f"{BASE_URL}/api/seasons/rollover-create", headers=headers, json=payload, timeout=30)
        assert r.status_code == 409, f"expected 409 overlap, got {r.status_code}: {r.text}"


# --- dashboard suggest_season flag ------------------------------------------

def test_dashboard_returns_suggest_season_flag(headers):
    r = requests.get(f"{BASE_URL}/api/dashboard", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "suggest_season" in data
    # Applereview account HAS seasons, so suggest_season MUST be False
    assert data["suggest_season"] is False, "applereview has seasons, suggest_season should be False"
