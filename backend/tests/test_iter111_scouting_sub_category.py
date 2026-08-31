"""Iter 111 — Scouting Tumbling sub_category (Standing/Running) tests.

Verifies:
  * GET /api/team/scouting/skills returns tumbling with sub_category standing/running,
    stunting/jumps with sub_category='', total counts match the coach-provided catalog
    (tumbling 67, stunting 84, jumps 45), and the L1/L6 spot-checks match the migration.
  * POST /api/team/scouting/skills honors sub_category for tumbling and ignores it for
    stunting/jumps.
  * POST /api/team/scouting/skills/reorder updates level_group + sub_category + order.
  * GET /api/team/scouting/report/{roster_id} exposes sub_category + level_group.

Cleans up any created skills at teardown so the demo household is left intact.
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL")
            or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://event-planner-394.preview.emergentagent.com").rstrip("/")
COACH_EMAIL = "coach.casey@cheerplanner.app"
COACH_PWD = "CheerDemo2026!"


@pytest.fixture(scope="module")
def coach_token() -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": COACH_EMAIL, "password": COACH_PWD}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def coach_hdr(coach_token: str) -> dict:
    return {"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_ids() -> list:
    ids = []
    yield ids
    # teardown — best effort cleanup
    tok = requests.post(f"{BASE_URL}/api/auth/login",
                        json={"email": COACH_EMAIL, "password": COACH_PWD}, timeout=15).json()
    tok = tok.get("access_token") or tok.get("token")
    hdr = {"Authorization": f"Bearer {tok}"}
    for sid in ids:
        try:
            requests.delete(f"{BASE_URL}/api/team/scouting/skills/{sid}", headers=hdr, timeout=10)
        except Exception:
            pass


# ---------------- Skill library shape ----------------

def test_library_counts_and_sub_categories(coach_hdr):
    r = requests.get(f"{BASE_URL}/api/team/scouting/skills", headers=coach_hdr, timeout=15)
    assert r.status_code == 200, r.text
    cats = r.json().get("categories") or {}

    tumbling = cats.get("tumbling") or []
    stunting = cats.get("stunting") or []
    jumps = cats.get("jumps") or []

    # Totals from coach catalog
    assert len(tumbling) == 67, f"tumbling total={len(tumbling)}"
    assert len(stunting) == 84, f"stunting total={len(stunting)}"
    assert len(jumps) == 45, f"jumps total={len(jumps)}"

    # Tumbling: every skill has sub_category standing or running
    for s in tumbling:
        assert s.get("sub_category") in ("standing", "running"), s

    # Stunting/Jumps sub_category is empty/absent
    for s in stunting + jumps:
        assert (s.get("sub_category") or "") == "", s


def test_tumbling_l1_l6_spot_checks(coach_hdr):
    r = requests.get(f"{BASE_URL}/api/team/scouting/skills", headers=coach_hdr, timeout=15)
    assert r.status_code == 200
    tumbling = r.json()["categories"]["tumbling"]

    def names(level, sub):
        return {s["name"] for s in tumbling
                if s.get("level_group") == level and s.get("sub_category") == sub}

    l1_std = names(1, "standing")
    l1_run = names(1, "running")
    assert "Forward roll" in l1_std
    assert "Handstand" in l1_std
    assert "Cartwheel" in l1_run
    assert "Round-off" in l1_run

    # Level 6 Standing should have ONLY "Standing full" (dedupe kept it at L5 boundary)
    l6_std = names(6, "standing")
    assert l6_std == {"Standing full"}, l6_std


# ---------------- Create honors / ignores sub_category ----------------

def test_create_tumbling_running_skill(coach_hdr, created_ids):
    payload = {"category": "tumbling", "level_group": 3, "sub_category": "running",
               "name": "TEST_iter111 Running Skill"}
    r = requests.post(f"{BASE_URL}/api/team/scouting/skills",
                      json=payload, headers=coach_hdr, timeout=15)
    assert r.status_code == 200, r.text
    skill = r.json()
    assert skill["sub_category"] == "running"
    assert skill["level_group"] == 3
    assert skill["category"] == "tumbling"
    created_ids.append(skill["id"])

    # Verify list reflects it
    lst = requests.get(f"{BASE_URL}/api/team/scouting/skills",
                       headers=coach_hdr, timeout=15).json()["categories"]["tumbling"]
    match = [s for s in lst if s["id"] == skill["id"]]
    assert match and match[0]["sub_category"] == "running"


def test_create_stunting_ignores_sub_category(coach_hdr, created_ids):
    payload = {"category": "stunting", "level_group": 2, "sub_category": "running",
               "name": "TEST_iter111 Stunting Ignore Sub"}
    r = requests.post(f"{BASE_URL}/api/team/scouting/skills",
                      json=payload, headers=coach_hdr, timeout=15)
    assert r.status_code == 200
    s = r.json()
    assert s["category"] == "stunting"
    assert s["sub_category"] == "", f"stunting sub_category should be forced empty, got {s['sub_category']!r}"
    created_ids.append(s["id"])


def test_create_jumps_ignores_sub_category(coach_hdr, created_ids):
    payload = {"category": "jumps", "level_group": 1, "sub_category": "standing",
               "name": "TEST_iter111 Jumps Ignore Sub"}
    r = requests.post(f"{BASE_URL}/api/team/scouting/skills",
                      json=payload, headers=coach_hdr, timeout=15)
    assert r.status_code == 200
    s = r.json()
    assert s["category"] == "jumps"
    assert s["sub_category"] == ""
    created_ids.append(s["id"])


# ---------------- Reorder updates sub_category ----------------

def test_reorder_updates_level_and_sub_category(coach_hdr, created_ids):
    # Create a tumbling standing skill and then move it to running L5.
    payload = {"category": "tumbling", "level_group": 2, "sub_category": "standing",
               "name": "TEST_iter111 Reorder Target"}
    c = requests.post(f"{BASE_URL}/api/team/scouting/skills",
                      json=payload, headers=coach_hdr, timeout=15)
    assert c.status_code == 200
    sk = c.json()
    created_ids.append(sk["id"])
    assert sk["sub_category"] == "standing"
    assert sk["level_group"] == 2

    # Reorder → move to running L5 pos 0
    body = {"items": [{"id": sk["id"], "category": "tumbling",
                       "level_group": 5, "sub_category": "running", "order": 0}]}
    r = requests.post(f"{BASE_URL}/api/team/scouting/skills/reorder",
                      json=body, headers=coach_hdr, timeout=15)
    assert r.status_code == 200, r.text

    # Verify persisted
    lst = requests.get(f"{BASE_URL}/api/team/scouting/skills",
                       headers=coach_hdr, timeout=15).json()["categories"]["tumbling"]
    match = next((s for s in lst if s["id"] == sk["id"]), None)
    assert match is not None
    assert match["level_group"] == 5
    assert match["sub_category"] == "running"
    assert match["order"] == 0


# ---------------- Report exposes sub_category / level_group ----------------

def test_scouting_report_exposes_sub_category(coach_hdr):
    ov = requests.get(f"{BASE_URL}/api/team/scouting/overview",
                      headers=coach_hdr, timeout=15).json()
    athletes = ov.get("athletes") or []
    assert athletes, "coach household should have at least one athlete"
    rid = athletes[0]["roster_id"]

    r = requests.get(f"{BASE_URL}/api/team/scouting/report/{rid}",
                     headers=coach_hdr, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    tumbling = data["categories"].get("tumbling") or []
    assert tumbling, "coach report should include tumbling skills"
    for s in tumbling:
        assert "sub_category" in s
        assert "level_group" in s
        assert s["sub_category"] in ("standing", "running"), s
    for s in data["categories"].get("stunting", []) + data["categories"].get("jumps", []):
        assert (s.get("sub_category") or "") == ""
