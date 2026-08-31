"""Tests for the new PUT /api/team/scouting/report/{roster_id}/skills/bulk endpoint.

Covers:
  - coach can set a level on many skills at once (verified via parent GET)
  - coach can clear/remove those skills (verified via parent GET)
  - invalid level -> 400
  - non-coach (parent) -> 403
  - only household's own skills are updated
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or "https://event-planner-394.preview.emergentagent.com"
API = f"{BASE_URL}/api"

COACH = {"email": "coach.casey@cheerplanner.app", "password": "CheerDemo2026!"}
PARENT = {"email": "parent.taylor@cheerplanner.app", "password": "CheerDemo2026!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def coach_token():
    return _login(COACH)


@pytest.fixture(scope="module")
def parent_token():
    return _login(PARENT)


@pytest.fixture(scope="module")
def roster_id(coach_token):
    r = requests.get(f"{API}/team/scouting/overview", headers={"Authorization": f"Bearer {coach_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("role") == "coach"
    athletes = j.get("athletes") or []
    assert athletes, "No athletes in coach's household — cannot run tests."
    # Prefer Ava Johnson if present, otherwise take first athlete.
    for a in athletes:
        if "ava" in (a.get("name") or "").lower():
            return a["roster_id"]
    return athletes[0]["roster_id"]


@pytest.fixture(scope="module")
def sample_skill_ids(coach_token):
    r = requests.get(f"{API}/team/scouting/skills", headers={"Authorization": f"Bearer {coach_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    cats = r.json().get("categories") or {}
    tumbling = cats.get("tumbling") or []
    assert len(tumbling) >= 3, f"Need at least 3 tumbling skills to run bulk tests. Got {len(tumbling)}"
    return [s["id"] for s in tumbling[:3]]


def _parent_view_levels(parent_token, roster_id):
    r = requests.get(f"{API}/team/scouting/report/{roster_id}", headers={"Authorization": f"Bearer {parent_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    lvls = {}
    for cat_skills in (j.get("categories") or {}).values():
        for s in cat_skills:
            lvls[s["skill_id"]] = s.get("level")
    return lvls


def _cleanup(coach_token, roster_id, skill_ids):
    requests.put(
        f"{API}/team/scouting/report/{roster_id}/skills/bulk",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"skill_ids": skill_ids, "level": ""},
        timeout=30,
    )


# ------------------------- happy path -------------------------
def test_bulk_set_level_visible_to_parent(coach_token, parent_token, roster_id, sample_skill_ids):
    """Coach bulk-sets level='spotted' -> parent GET shows those skills with level='spotted'."""
    r = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skills/bulk",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"skill_ids": sample_skill_ids, "level": "spotted"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("updated") == len(sample_skill_ids), body

    lvls = _parent_view_levels(parent_token, roster_id)
    for sid in sample_skill_ids:
        assert lvls.get(sid) == "spotted", f"skill {sid} not visible to parent as 'spotted' (got {lvls.get(sid)})"

    _cleanup(coach_token, roster_id, sample_skill_ids)


def test_bulk_remove_hides_from_parent(coach_token, parent_token, roster_id, sample_skill_ids):
    """Bulk with level='' removes them; parent GET no longer includes those skills."""
    # First, set a level
    r1 = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skills/bulk",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"skill_ids": sample_skill_ids, "level": "unassisted"},
        timeout=30,
    )
    assert r1.status_code == 200

    # Now clear
    r2 = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skills/bulk",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"skill_ids": sample_skill_ids, "level": ""},
        timeout=30,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json().get("updated") == len(sample_skill_ids)

    lvls = _parent_view_levels(parent_token, roster_id)
    for sid in sample_skill_ids:
        # Parent view excludes skills with no level — skill_id should not appear
        assert sid not in lvls, f"skill {sid} still visible to parent after remove (level={lvls.get(sid)})"


# ------------------------- validation -------------------------
def test_bulk_invalid_level_returns_400(coach_token, roster_id, sample_skill_ids):
    r = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skills/bulk",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"skill_ids": sample_skill_ids, "level": "expert_mode"},
        timeout=30,
    )
    assert r.status_code == 400, f"Expected 400 for invalid level, got {r.status_code}: {r.text}"


def test_bulk_empty_skill_ids_ok_noop(coach_token, roster_id):
    r = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skills/bulk",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"skill_ids": [], "level": "spotted"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("updated") == 0


# ------------------------- authorization -------------------------
def test_bulk_as_parent_forbidden(parent_token, roster_id, sample_skill_ids):
    """Parent (non-coach) must get 403 (require_team_access should reject or role check)."""
    r = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skills/bulk",
        headers={"Authorization": f"Bearer {parent_token}"},
        json={"skill_ids": sample_skill_ids, "level": "spotted"},
        timeout=30,
    )
    assert r.status_code == 403, f"Expected 403 for parent, got {r.status_code}: {r.text}"


# ------------------------- household scoping -------------------------
def test_bulk_ignores_foreign_skill_ids(coach_token, roster_id, sample_skill_ids):
    """Passing a made-up skill id -> that entry is silently ignored, valid skills still applied.
    updated should equal number of skill_ids that actually belong to this coach's household.
    """
    foreign_id = "00000000-0000-0000-0000-000000000000"
    skill_ids = sample_skill_ids + [foreign_id]
    r = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skills/bulk",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"skill_ids": skill_ids, "level": "on_deck"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("updated") == len(sample_skill_ids), r.json()
    _cleanup(coach_token, roster_id, sample_skill_ids)


# ------------------------- regression: single-skill still works -------------------------
def test_single_skill_endpoint_still_works(coach_token, parent_token, roster_id, sample_skill_ids):
    sid = sample_skill_ids[0]
    r1 = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skill/{sid}",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"level": "hit_zero", "notes": "TEST_bulk_regression"},
        timeout=30,
    )
    assert r1.status_code == 200, r1.text
    lvls = _parent_view_levels(parent_token, roster_id)
    assert lvls.get(sid) == "hit_zero"

    # Remove it (single-skill "" level)
    r2 = requests.put(
        f"{API}/team/scouting/report/{roster_id}/skill/{sid}",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"level": "", "notes": ""},
        timeout=30,
    )
    assert r2.status_code == 200
    lvls2 = _parent_view_levels(parent_token, roster_id)
    assert sid not in lvls2
