"""iter121: Re-link cleanup. When an already-active member is re-linked to a
different EXISTING roster entry via POST /api/team/members/{uid}/assign-role
{role, athlete_roster_id: <different id>}, the previously auto-created
duplicate roster row (linked_id == user) must be DELETED. Net roster count
stays flat. Any athlete_chat_links pointing at the removed row are removed too.

Also regressions:
  * assigning WITHOUT athlete_roster_id (fresh signup) still creates a fresh
    roster entry (no wrong-side cleanup happens because there's no target).
  * re-linking to the SAME id we're already linked to does NOT delete it.

Uses the PUBLIC preview URL. No Twilio/SendGrid triggered.
"""
import os
import time
import uuid

import pytest
import requests
from pymongo import MongoClient


def _base_url() -> str:
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
    time.sleep(0.2)  # auth rate-limiter pacing
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
    owner_email = f"TEST_owner121_{tag}@t.com"
    owner_tok, oid = _su(owner_email)
    _db.users.update_one({"id": oid}, {"$set": {"team_access": True}})

    # Trigger household creation.
    requests.get(f"{B}/auth/me", headers=_h(owner_tok), timeout=15)

    r = requests.get(f"{B}/team/join-code", headers=_h(owner_tok), timeout=15)
    assert r.status_code == 200, r.text
    code = r.json()["code"]

    # Seed existing roster entries via direct DB insert (bypasses free-tier caps).
    roster_ids = {}
    for role, name in (("coach", f"TEST Existing Coach {tag}"),
                       ("staff", f"TEST Existing Staff {tag}"),
                       ("athlete", f"TEST Existing Athlete {tag}")):
        rid = f"rost_{role}_{tag}"
        _db.roster.insert_one({
            "id": rid, "user_id": oid, "name": name,
            "role": role, "source": "manual",
        })
        roster_ids[role] = rid

    yield {"tok": owner_tok, "id": oid, "code": code, "roster_ids": roster_ids, "email": owner_email}

    # Cleanup
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


# --- 1. coach: fresh -> relink to existing coach roster removes duplicate ----
def test_coach_relink_cleans_up_duplicate(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "coachrelink")

    # First assign WITHOUT athlete_roster_id -> creates fresh roster entry
    r1 = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach"},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r1.status_code == 200, r1.text
    fresh = _db.roster.find_one({"user_id": owner_ctx["id"], "linked_id": uid, "role": "coach"})
    assert fresh, "fresh roster row should exist after first assign"
    fresh_id = fresh["id"]

    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    target_rid = owner_ctx["roster_ids"]["coach"]
    assert target_rid != fresh_id

    # Now RELINK to the pre-existing coach roster entry
    r2 = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach", "athlete_roster_id": target_rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["athlete_roster_id"] == target_rid

    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before - 1, f"expected duplicate deleted; before={before} after={after}"

    # The old duplicate row is gone
    assert _db.roster.find_one({"id": fresh_id}) is None, "duplicate row should be deleted"
    # Target row is now linked to the user
    target = _db.roster.find_one({"id": target_rid})
    assert target.get("linked_id") == uid
    assert target.get("role") == "coach"
    # No stray roster entries with linked_id == uid other than the target
    linked_rows = list(_db.roster.find({"user_id": owner_ctx["id"], "linked_id": uid}))
    assert len(linked_rows) == 1 and linked_rows[0]["id"] == target_rid


# --- 2. staff same relink cleanup --------------------------------------------
def test_staff_relink_cleans_up_duplicate(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "staffrelink")

    r1 = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "staff"},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r1.status_code == 200
    fresh = _db.roster.find_one({"user_id": owner_ctx["id"], "linked_id": uid, "role": "staff"})
    assert fresh
    fresh_id = fresh["id"]

    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    target_rid = owner_ctx["roster_ids"]["staff"]

    r2 = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "staff", "athlete_roster_id": target_rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r2.status_code == 200, r2.text

    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before - 1, "duplicate should be cleaned up on staff relink"
    assert _db.roster.find_one({"id": fresh_id}) is None
    assert _db.roster.find_one({"id": target_rid}).get("linked_id") == uid


# --- 3. athlete relink cleanup + athlete_chat_links purged for removed row --
def test_athlete_relink_cleans_up_duplicate_and_chat_link(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "athletere")

    r1 = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "athlete"},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r1.status_code == 200, r1.text
    fresh = _db.roster.find_one({"user_id": owner_ctx["id"], "linked_id": uid, "role": "athlete"})
    assert fresh
    fresh_id = fresh["id"]

    hh = _db.households.find_one({"owner_user_id": owner_ctx["id"]})
    # Confirm the chat link on the duplicate exists before we relink
    assert _db.athlete_chat_links.find_one({"household_id": hh["id"], "roster_id": fresh_id})

    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    target_rid = owner_ctx["roster_ids"]["athlete"]

    r2 = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "athlete", "athlete_roster_id": target_rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r2.status_code == 200, r2.text

    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before - 1, "athlete relink should clean up prior auto-created row"
    assert _db.roster.find_one({"id": fresh_id}) is None
    assert _db.roster.find_one({"id": target_rid}).get("linked_id") == uid

    # chat link for the deleted row must be gone; the target row has one
    assert _db.athlete_chat_links.find_one({"household_id": hh["id"], "roster_id": fresh_id}) is None
    assert _db.athlete_chat_links.find_one({"household_id": hh["id"], "roster_id": target_rid})


# --- 4. Regression: assigning without athlete_roster_id still creates fresh ---
def test_no_link_still_creates_fresh_no_wrong_deletes(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "noLink")

    # Pre-seed an unrelated linked roster row for a DIFFERENT owner user – it
    # must NOT be touched by this call. Simulate by having 2 pre-existing rows
    # with linked_id == some other uid.
    other_uid = f"other_{tag}"
    _db.roster.insert_one({
        "id": f"rost_other_{tag}", "user_id": owner_ctx["id"],
        "name": "TEST Unrelated", "role": "coach", "source": "manual",
        "linked_id": other_uid,
    })

    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    r = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach"},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == before + 1, "no-link path should still create a fresh row"
    # Unrelated row still present
    assert _db.roster.find_one({"id": f"rost_other_{tag}"})


# --- 5. Re-linking to the SAME id we're already linked to does NOT delete it --
def test_relink_to_same_id_is_noop_and_does_not_delete(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    _, uid = _fresh_joiner(owner_ctx["code"], tag, "samerelink")

    target_rid = owner_ctx["roster_ids"]["coach"]

    # First assign with link (roster count unchanged)
    before = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    r1 = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach", "athlete_roster_id": target_rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r1.status_code == 200, r1.text
    mid = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert mid == before, "first link should not add rows"
    assert _db.roster.find_one({"id": target_rid, "linked_id": uid})

    # Relink to the SAME id -> still no deletion of the target row
    r2 = requests.post(
        f"{B}/team/members/{uid}/assign-role",
        json={"role": "coach", "athlete_roster_id": target_rid},
        headers=_h(owner_ctx["tok"]),
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    after = _db.roster.count_documents({"user_id": owner_ctx["id"]})
    assert after == mid, "same-id relink should be a no-op on count"
    # Target row still exists and still linked to uid
    tgt = _db.roster.find_one({"id": target_rid})
    assert tgt and tgt.get("linked_id") == uid
