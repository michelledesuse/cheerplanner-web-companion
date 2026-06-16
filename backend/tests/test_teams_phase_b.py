"""Phase B: Teams feature backend tests.

Covers:
- Teams CRUD (create / list / patch / delete)
- Athlete team_ids cap (athlete <=3, coach unlimited) on POST and PATCH
- Competition team_ids / team_meet_times / teams_to_watch round-trip via PATCH
- Cascade: deleting a team strips it from athletes + competitions + team_meet_times
- Bulk-delete with resource="teams"
- Regression: athletes, competitions, payments still work
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # fall back to frontend/.env loaded by main process
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.strip().split("=", 1)[1]
                    break
    except Exception:
        pass
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"

EMAIL = "smoke@test.com"
PASSWORD = "password123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # login
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        # try to signup if not exists
        s.post(f"{BASE_URL}/api/auth/signup", json={"email": EMAIL, "password": PASSWORD, "name": "Smoke"})
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def created():
    """Track ids created during run for teardown."""
    return {"teams": [], "athletes": [], "competitions": []}


def teardown_module(module):
    # Best-effort cleanup is implicit in test bodies; tests delete what they create.
    pass


# ---------- 1. POST /api/teams ----------
def test_01_create_team(client, created):
    r = client.post(f"{BASE_URL}/api/teams", json={
        "name": "TEST_Senior Elite",
        "color": "#FF00AA",
        "season": "2025-2026",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["id"] and data["name"] == "TEST_Senior Elite"
    assert data["color"] == "#FF00AA"
    assert data["season"] == "2025-2026"
    created["teams"].append(data["id"])


# ---------- 2. GET /api/teams ----------
def test_02_list_teams_scoped(client, created):
    r = client.get(f"{BASE_URL}/api/teams")
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()]
    assert created["teams"][0] in ids
    # Smoke check: every team has a user_id we can see
    for t in r.json():
        assert "user_id" in t and t["user_id"]


# ---------- 3. PATCH /api/teams/{id} ----------
def test_03_update_team(client, created):
    tid = created["teams"][0]
    r = client.patch(f"{BASE_URL}/api/teams/{tid}", json={"name": "TEST_Senior Elite v2", "color": "#112233"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["name"] == "TEST_Senior Elite v2"
    assert data["color"] == "#112233"
    assert data["season"] == "2025-2026"  # unchanged


# ---------- 4. POST /api/athletes - athlete with 4 teams -> 400 ----------
def test_04_create_athlete_cap_400(client):
    fake_team_ids = [str(uuid.uuid4()) for _ in range(4)]
    r = client.post(f"{BASE_URL}/api/athletes", json={
        "name": "TEST_OverCap",
        "role": "athlete",
        "team_ids": fake_team_ids,
    })
    assert r.status_code == 400, r.text
    assert "at most 3 teams" in r.json().get("detail", "")


# ---------- 5. POST /api/athletes - coach with 5 teams -> 200 ----------
def test_05_create_coach_unlimited(client, created):
    five_teams = [str(uuid.uuid4()) for _ in range(5)]
    r = client.post(f"{BASE_URL}/api/athletes", json={
        "name": "TEST_Coach Carol",
        "role": "coach",
        "team_ids": five_teams,
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["role"] == "coach"
    assert len(data["team_ids"]) == 5
    created["athletes"].append(data["id"])


# ---------- 6. PATCH athlete with 3 teams -> add 4th -> 400 ----------
def test_06_patch_athlete_cap(client, created):
    # Create an athlete with 3 teams first
    three = [str(uuid.uuid4()) for _ in range(3)]
    r = client.post(f"{BASE_URL}/api/athletes", json={
        "name": "TEST_Three Teamer",
        "role": "athlete",
        "team_ids": three,
    })
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    created["athletes"].append(aid)
    # Now try to add a 4th
    four = three + [str(uuid.uuid4())]
    r = client.patch(f"{BASE_URL}/api/athletes/{aid}", json={"team_ids": four})
    assert r.status_code == 400, r.text
    assert "at most 3 teams" in r.json().get("detail", "")
    # Confirm DB still has the old 3
    r = client.get(f"{BASE_URL}/api/athletes")
    me = next(a for a in r.json() if a["id"] == aid)
    assert len(me["team_ids"]) == 3


# ---------- 7. PATCH competition - team_ids + team_meet_times + teams_to_watch round-trip ----------
def test_07_competition_team_fields_round_trip(client, created):
    # Need real team ids (the cascade test will use them)
    r1 = client.post(f"{BASE_URL}/api/teams", json={"name": "TEST_T1"})
    r2 = client.post(f"{BASE_URL}/api/teams", json={"name": "TEST_T2"})
    assert r1.status_code == 200 and r2.status_code == 200
    t1, t2 = r1.json()["id"], r2.json()["id"]
    created["teams"].extend([t1, t2])
    # Create a competition
    r = client.post(f"{BASE_URL}/api/competitions", json={
        "name": "TEST_Comp A", "event_date": "2026-03-15",
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    created["competitions"].append(cid)

    # PATCH with all three new lists
    patch_body = {
        "team_ids": [t1, t2],
        "team_meet_times": [
            {"team_id": t1, "performance_time": "14:30", "performance_location": "Arena A"},
        ],
        "teams_to_watch": [
            {"name": "Cheetahs", "date": "2026-03-15", "location": "Arena B", "performance_time": "16:00"},
        ],
    }
    r = client.patch(f"{BASE_URL}/api/competitions/{cid}", json=patch_body)
    assert r.status_code == 200, r.text

    # GET round-trip
    r = client.get(f"{BASE_URL}/api/competitions/{cid}")
    assert r.status_code == 200
    c = r.json()
    assert set(c["team_ids"]) == {t1, t2}
    assert len(c["team_meet_times"]) == 1
    assert c["team_meet_times"][0]["team_id"] == t1
    assert c["team_meet_times"][0]["performance_time"] == "14:30"
    assert c["team_meet_times"][0]["performance_location"] == "Arena A"
    assert len(c["teams_to_watch"]) == 1
    assert c["teams_to_watch"][0]["name"] == "Cheetahs"
    assert c["teams_to_watch"][0]["performance_time"] == "16:00"


# ---------- 8. DELETE team -> cascade strips refs ----------
def test_08_delete_team_cascade(client, created):
    # Use t1 from test_07 (last 2 entries of created["teams"])
    t1 = created["teams"][-2]
    # Also link t1 onto an athlete so we can verify athlete pull
    r = client.post(f"{BASE_URL}/api/athletes", json={
        "name": "TEST_Linked Athlete",
        "role": "athlete",
        "team_ids": [t1],
    })
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    created["athletes"].append(aid)

    cid = created["competitions"][-1]
    # Delete the team
    r = client.delete(f"{BASE_URL}/api/teams/{t1}")
    assert r.status_code == 200, r.text
    assert r.json().get("deleted") is True

    # Athlete should no longer have t1
    r = client.get(f"{BASE_URL}/api/athletes")
    me = next(a for a in r.json() if a["id"] == aid)
    assert t1 not in me["team_ids"], f"team_id still present on athlete: {me['team_ids']}"

    # Competition: team_ids should no longer contain t1, and team_meet_times for t1 should be gone
    r = client.get(f"{BASE_URL}/api/competitions/{cid}")
    c = r.json()
    assert t1 not in c["team_ids"]
    assert all(mt["team_id"] != t1 for mt in c["team_meet_times"])

    # remove t1 from tracked list (already deleted)
    created["teams"].remove(t1)


# ---------- 9. Bulk delete teams ----------
def test_09_bulk_delete_teams(client, created):
    # Make sure we have >=2 teams
    while len(created["teams"]) < 2:
        r = client.post(f"{BASE_URL}/api/teams", json={"name": f"TEST_Bulk_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200
        created["teams"].append(r.json()["id"])

    targets = created["teams"][:2]
    r = client.post(f"{BASE_URL}/api/bulk-delete", json={"resource": "teams", "ids": targets})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("deleted") == 2, body

    # Confirm they no longer appear in GET /api/teams
    r = client.get(f"{BASE_URL}/api/teams")
    remaining = {t["id"] for t in r.json()}
    for tid in targets:
        assert tid not in remaining
    for tid in targets:
        created["teams"].remove(tid)


# ---------- 10. Regression: existing endpoints work ----------
def test_10a_regression_athletes_list(client):
    r = client.get(f"{BASE_URL}/api/athletes")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_10b_regression_competitions_list(client):
    r = client.get(f"{BASE_URL}/api/competitions")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_10c_regression_expenses_bulk_delete(client):
    # create + delete a throwaway expense via bulk-delete
    # need an athlete
    r = client.get(f"{BASE_URL}/api/athletes")
    athletes = r.json()
    if not athletes:
        pytest.skip("no athletes available")
    aid = athletes[0]["id"]
    r = client.post(f"{BASE_URL}/api/expenses", json={
        "athlete_id": aid, "category": "Misc", "amount": 12.34,
        "incurred_on": "2026-01-10", "note": "TEST_regression",
    })
    assert r.status_code == 200, r.text
    eid = r.json()[0]["id"]
    r = client.post(f"{BASE_URL}/api/bulk-delete", json={"resource": "expenses", "ids": [eid]})
    assert r.status_code == 200
    assert r.json().get("deleted") == 1


def test_10d_regression_payment_create(client):
    r = client.get(f"{BASE_URL}/api/athletes")
    athletes = r.json()
    if not athletes:
        pytest.skip("no athletes available")
    aid = athletes[0]["id"]
    r = client.post(f"{BASE_URL}/api/payments", json={
        "athlete_id": aid, "amount": 5.0, "paid_on": "2026-01-10", "note": "TEST_regression",
    })
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # cleanup
    client.delete(f"{BASE_URL}/api/payments/{pid}")


# ---------- Final cleanup ----------
def test_99_cleanup(client, created):
    # delete remaining teams
    for tid in list(created["teams"]):
        client.delete(f"{BASE_URL}/api/teams/{tid}")
    # delete athletes
    for aid in list(created["athletes"]):
        client.delete(f"{BASE_URL}/api/athletes/{aid}")
    # delete competitions
    for cid in list(created["competitions"]):
        client.delete(f"{BASE_URL}/api/competitions/{cid}")
