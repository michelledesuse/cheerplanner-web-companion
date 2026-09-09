"""iter119 P0: Owner can consolidate a joining member into an EXISTING roster
entry (coach/staff/athlete) instead of creating a duplicate roster row.

Backend under test: POST /api/team/members/{user_id}/assign-role with
`athlete_roster_id` pointing to an existing roster entry.

Uses the PUBLIC EXPO_PUBLIC_BACKEND_URL so it exercises exactly what mobile
clients hit. No Twilio/SendGrid is triggered by these endpoints.
"""
import os
import time
import uuid

import pytest
import requests
from pymongo import MongoClient


def _base_url() -> str:
    # Prefer the public preview URL (what mobile hits); fall back to local.
    for key in ("EXPO_PUBLIC_BACKEND_URL", "EXPO_BACKEND_URL", "TEST_BASE"):
        v = os.environ.get(key)
        if v:
            return v.rstrip("/")
    return "http://localhost:8001"


B = _base_url() + "/api"
_db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _su(email: str):
    time.sleep(0.2)  # pacing for auth rate limiter
    r = requests.post(
        f"{B}/auth/signup",
        json={"email": email, "password": "Pass2026!", "name": email.split("@")[0].title()},
        timeout=30,
    )
    assert r.status_code in (200, 201), f"signup {email}: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]["id"]


@pytest.fixture(scope="module")
def owner_ctx():
    """Owner with team_access + a hub + a pre-seeded roster (coach/staff/athlete)."""
    tag = uuid.uuid4().hex[:6]
    owner_email = f"TEST_owner_{tag}@t.com"
    owner_tok, oid = _su(owner_email)
    _db.users.update_one({"id": oid}, {"$set": {"team_access": True}})

    # Trigger household creation via /auth/me (also warms /api/team/join-code below).
    requests.get(f"{B}/auth/me", headers=_h(owner_tok), timeout=15)

    # Owner obtains the reusable team code.
    r = requests.get(f"{B}/team/join-code", headers=_h(owner_tok), timeout=15)
    assert r.status_code == 200, r.text
    code = r.json()["code"]

    # Seed existing roster entries via POST /api/roster (mimics real-world "owner
    # already entered roster before members joined").
    roster_ids = {}
    for role, name in (("coach", "TEST Existing Coach"), ("staff", "TEST Existing Staff"), ("athlete", "TEST Existing Athlete")):
        rr = requests.post(f"{B}/roster", json={"name": name, "role": role}, headers=_h(owner_tok), timeout=15)
        assert rr.status_code in (200, 201), f"seed roster {role}: {rr.status_code} {rr.text}"
        body = rr.json()
        roster_ids[role] = body.get("id") or body.get("roster_id") or (body.get("member") or {}).get("id")
        assert roster_ids[role], f"missing roster id in {body}"

    yield {"tok": owner_tok, "id": oid, "code": code, "roster_ids": roster_ids, "email": owner_email}

    # Cleanup roster/team_members/household for this owner
    _db.roster.delete_many({"user_id": oid})
    hh = _db.households.find_one({"owner_user_id": oid})
    if hh:
        _db.team_members.delete_many({"household_id": hh["id"]})
        _db.athlete_chat_links.delete_many({"household_id": hh["id"]})
    _db.users.delete_many({"email": {"$regex": "^TEST_"}})


def _fresh_joiner(code: str, tag: str, kind: str):
    tok, uid = _su(f"TEST_{kind}_{tag}@t.com")
    jr = requests.post(f"{B}/team/join", json={"code": code}, headers=_h(tok), timeout=15)
    assert jr.status_code == 200 and jr.json().get("status") == "pending", jr.text
    return tok, uid


# --- 1. coach linked to existing coach roster -> UPDATE, no duplicate --------
def test_coach_consolidates_into_existing_roster(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "coach")
    existing_rid = owner_ctx["roster_ids"]["coach"]
    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})

    r = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach", "athlete_roster_id": existing_rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "coach" and body["status"] == "active"
    assert body["athlete_roster_id"] == existing_rid

    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before, f"duplicate roster created: before={before} after={after}"

    updated = _db.roster.find_one({"id": existing_rid})
    assert updated["role"] == "coach"
    assert updated.get("linked_id") == uid
    assert updated.get("email") == f"TEST_coach_{tag}@t.com".lower()

    tm = _db.team_members.find_one({"user_id": uid})
    assert tm and tm["status"] == "active" and tm["role"] == "coach"


# --- 2. staff linked to existing staff roster --------------------------------
def test_staff_consolidates_into_existing_roster(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "staff")
    existing_rid = owner_ctx["roster_ids"]["staff"]
    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})

    r = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "staff", "athlete_roster_id": existing_rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["athlete_roster_id"] == existing_rid

    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before, "duplicate roster created for staff link"

    updated = _db.roster.find_one({"id": existing_rid})
    assert updated["role"] == "staff"
    assert updated.get("linked_id") == uid
    assert updated.get("email") == f"TEST_staff_{tag}@t.com".lower()


# --- 3. athlete linked to existing athlete roster ----------------------------
def test_athlete_consolidates_into_existing_roster(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "athlete")
    existing_rid = owner_ctx["roster_ids"]["athlete"]
    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})

    r = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "athlete", "athlete_roster_id": existing_rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["athlete_roster_id"] == existing_rid

    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before, "duplicate athlete roster created"

    updated = _db.roster.find_one({"id": existing_rid})
    assert updated.get("linked_id") == uid
    assert updated.get("email") == f"TEST_athlete_{tag}@t.com".lower()

    link = _db.athlete_chat_links.find_one({"roster_id": existing_rid, "athlete_user_id": uid})
    assert link and link.get("chat_enabled") is True


# --- 4. Regression: coach WITHOUT athlete_roster_id -> creates fresh roster ---
def test_coach_without_link_creates_new_roster(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "coach2")
    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})

    r = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach"},  # no athlete_roster_id
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before + 1, f"expected fresh coach roster; before={before} after={after}"
    assert _db.roster.find_one({"user_id": owner_ctx["id"], "linked_id": uid, "role": "coach"})


# --- 5. Regression: staff WITHOUT athlete_roster_id -> creates fresh roster ---
def test_staff_without_link_creates_new_roster(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "staff2")
    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    r = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "staff"},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before + 1
    assert _db.roster.find_one({"user_id": owner_ctx["id"], "linked_id": uid, "role": "staff"})


# --- 6. GET /api/team/members/athletes returns roster entries of ANY role ----
def test_members_athletes_endpoint_returns_all_roles(owner_ctx):
    r = requests.get(f"{B}/team/members/athletes", headers=_h(owner_ctx["tok"]), timeout=15)
    assert r.status_code == 200, r.text
    items = r.json().get("athletes") or []
    roles_returned = {i.get("role") for i in items}
    # Must include our seeded roles so owner UI can pick from any of them.
    assert {"coach", "staff", "athlete"}.issubset(roles_returned), roles_returned
    # Each entry has roster_id + name
    for it in items:
        assert it.get("roster_id") and it.get("name")


# --- 7. Full join->assign happy-path with real GET /api/team/members ---------
def test_full_join_then_consolidate_flow(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    # Seed a fresh "existing" coach roster directly in DB (bypasses free-tier
    # personnel cap; the point of this test is the consolidation flow itself).
    rid = f"rost_flow_{tag}"
    _db.roster.insert_one({
        "id": rid, "user_id": owner_ctx["id"], "name": f"TEST Flow Coach {tag}",
        "role": "coach", "source": "manual",
    })

    _, uid = _fresh_joiner(owner_ctx["code"], tag, "flow")

    # Appears in pending list
    lst = requests.get(f"{B}/team/members", headers=_h(owner_ctx["tok"]), timeout=15).json()
    assert any(m["user_id"] == uid for m in lst["pending"])

    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    a = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach", "athlete_roster_id": rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert a.status_code == 200, a.text
    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before, "duplicate roster row created in full flow"

    lst2 = requests.get(f"{B}/team/members", headers=_h(owner_ctx["tok"]), timeout=15).json()
    active_ids = {m["user_id"]: m for m in lst2["active"]}
    assert uid in active_ids
    assert active_ids[uid]["role"] == "coach"
    assert active_ids[uid]["athlete_roster_id"] == rid


# --- 8. Guardrail: bogus athlete_roster_id -> 404 (no partial writes) --------
def test_assign_with_unknown_roster_id_returns_404(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "bogus")
    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    r = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach", "athlete_roster_id": "does-not-exist-xyz"},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r.status_code == 404, r.text
    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before, "no roster row should be created when link target is missing"
