"""iter126: Coach/staff share-link fix + assign_role auto-match + non-destructive consolidation.

Covers the 7 scenarios in the review request:
  1. request-info for a COACH roster member -> token, public/data resolves 200
  2. request-info for an ATHLETE roster member still resolves 200 (no regression)
  3. Stale-link refresh: old (>30d) link -> new token minted; old returns 404; new returns 200
  4. Public HTML page shows real reason for expired vs invalid tokens
  5. assign_role auto-match by email (no athlete_roster_id) -> attaches to existing roster row
  6. Non-destructive consolidation: duplicate row's share_link re-pointed to survivor & still active
  7. Auth: /assign-role requires owner (rejects non-owner / no-token)

Uses the PUBLIC preview URL. No SMS/Email triggered.
"""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

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


def _login_demo():
    r = requests.post(f"{B}/auth/login",
                      json={"email": "demo@cheerplanner.app", "password": "CheerDemo2026!"},
                      timeout=30)
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _su(email: str):
    time.sleep(0.25)
    r = requests.post(f"{B}/auth/signup",
                      json={"email": email, "password": "Pass2026!", "name": email.split("@")[0].title()},
                      timeout=30)
    assert r.status_code in (200, 201), f"signup {email}: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]["id"]


@pytest.fixture(scope="module")
def demo_ctx():
    """Login as the seeded demo owner and grab the ownership household + roster."""
    tok, uid = _login_demo()
    # Ensure premium (share links are gated). Demo account is premium per credentials note.
    r = requests.get(f"{B}/roster", headers=_h(tok), timeout=20)
    assert r.status_code == 200, r.text
    roster = r.json() if isinstance(r.json(), list) else r.json().get("roster") or r.json().get("items") or []
    by_role = {}
    for m in roster:
        by_role.setdefault(m.get("role") or "athlete", []).append(m)
    # Track any share_links we create to clean up
    created_tokens: list[str] = []
    yield {"tok": tok, "id": uid, "roster": roster, "by_role": by_role, "created_tokens": created_tokens}
    if created_tokens:
        _db.share_links.delete_many({"token": {"$in": created_tokens}})


# --- 1. request-info for a COACH resolves via public data ------------------
def test_request_info_for_coach_resolves(demo_ctx):
    coaches = demo_ctx["by_role"].get("coach") or []
    assert coaches, "demo roster should include at least one coach"
    coach = coaches[0]
    r = requests.post(f"{B}/team/roster/{coach['id']}/request-info",
                      json={"send": False}, headers=_h(demo_ctx["tok"]), timeout=20)
    assert r.status_code == 200, r.text
    tok = r.json().get("token")
    assert tok, r.text
    demo_ctx["created_tokens"].append(tok)
    # public data resolves
    pd = requests.get(f"{B}/public/share/{tok}/data", timeout=20)
    assert pd.status_code == 200, f"coach public data: {pd.status_code} {pd.text}"
    body = pd.json()
    assert body.get("kind") == "roster_member"
    m = body.get("member") or {}
    assert m.get("id") == coach["id"]
    assert (m.get("role") or "") == "coach"


# --- 2. request-info for an ATHLETE still resolves (regression check) ------
def test_request_info_for_athlete_still_resolves(demo_ctx):
    athletes = demo_ctx["by_role"].get("athlete") or []
    assert athletes
    athlete = athletes[0]
    r = requests.post(f"{B}/team/roster/{athlete['id']}/request-info",
                      json={"send": False}, headers=_h(demo_ctx["tok"]), timeout=20)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    demo_ctx["created_tokens"].append(tok)
    pd = requests.get(f"{B}/public/share/{tok}/data", timeout=20)
    assert pd.status_code == 200
    assert pd.json().get("kind") == "roster_member"


# --- 3. Stale-link refresh: old (>30d) link -> new token; old 404, new 200 --
def test_stale_link_refresh(demo_ctx):
    # Pick a team_rep if available else any non-athlete/non-coach; otherwise fall back
    pool = (demo_ctx["by_role"].get("team_rep") or demo_ctx["by_role"].get("staff")
            or demo_ctx["by_role"].get("coach") or demo_ctx["by_role"].get("athlete") or [])
    assert pool
    member = pool[0]
    # First: get a link
    r1 = requests.post(f"{B}/team/roster/{member['id']}/request-info",
                       json={"send": False}, headers=_h(demo_ctx["tok"]), timeout=20)
    assert r1.status_code == 200, r1.text
    old_token = r1.json()["token"]
    demo_ctx["created_tokens"].append(old_token)

    # Confirm old link works today
    ok = requests.get(f"{B}/public/share/{old_token}/data", timeout=15)
    assert ok.status_code == 200

    # Backdate its created_at to >30 days ago
    old_iso = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    upd = _db.share_links.update_one({"token": old_token}, {"$set": {"created_at": old_iso}})
    assert upd.modified_count == 1

    # Requesting again should mint a NEW token
    r2 = requests.post(f"{B}/team/roster/{member['id']}/request-info",
                       json={"send": False}, headers=_h(demo_ctx["tok"]), timeout=20)
    assert r2.status_code == 200, r2.text
    new_token = r2.json()["token"]
    demo_ctx["created_tokens"].append(new_token)
    assert new_token != old_token, "should mint a fresh token when the old one is stale"

    # Old token now inactive/expired -> 404 from data endpoint
    old_after = requests.get(f"{B}/public/share/{old_token}/data", timeout=15)
    assert old_after.status_code == 404, f"expected 404 for stale token, got {old_after.status_code}"

    # New token works
    new_after = requests.get(f"{B}/public/share/{new_token}/data", timeout=15)
    assert new_after.status_code == 200


# --- 4. Public HTML page shows real reason (expired vs invalid) ------------
def test_public_html_expired_vs_invalid_messages(demo_ctx):
    # Genuinely unknown token -> "invalid or has been turned off"
    unknown = requests.get(f"{B}/public/s/nosuchtoken_xyz_123", timeout=15)
    assert unknown.status_code in (200, 404)
    assert "This link is invalid or has been turned off." in unknown.text

    # Create a link then backdate it and mark inactive=False (it should still be
    # considered expired because created_at is old and active=True).
    athletes = demo_ctx["by_role"].get("athlete") or []
    assert athletes
    r = requests.post(f"{B}/team/roster/{athletes[0]['id']}/request-info",
                      json={"send": False}, headers=_h(demo_ctx["tok"]), timeout=20)
    tok = r.json()["token"]
    demo_ctx["created_tokens"].append(tok)
    # Backdate
    _db.share_links.update_one(
        {"token": tok},
        {"$set": {"created_at": (datetime.now(timezone.utc) - timedelta(days=60)).isoformat(),
                  "active": True}},
    )
    exp = requests.get(f"{B}/public/s/{tok}", timeout=15)
    assert exp.status_code == 404, exp.status_code
    assert "This link has expired. Please ask for a new one." in exp.text, exp.text[:400]
    # And should NOT show the invalid message
    assert "This link is invalid or has been turned off." not in exp.text


# ----- assign_role helpers using a fresh sandbox owner ---------------------
@pytest.fixture(scope="module")
def owner_ctx():
    tag = uuid.uuid4().hex[:6]
    email = f"TEST_own126_{tag}@t.com"
    tok, uid = _su(email)
    _db.users.update_one({"id": uid}, {"$set": {"team_access": True}})
    requests.get(f"{B}/auth/me", headers=_h(tok), timeout=15)
    r = requests.get(f"{B}/team/join-code", headers=_h(tok), timeout=15)
    assert r.status_code == 200
    code = r.json()["code"]
    yield {"tok": tok, "id": uid, "code": code, "email": email, "tag": tag}
    # cleanup
    _db.roster.delete_many({"user_id": uid})
    hh = _db.households.find_one({"owner_user_id": uid})
    if hh:
        _db.team_members.delete_many({"household_id": hh["id"]})
        _db.athlete_chat_links.delete_many({"household_id": hh["id"]})
        _db.share_links.delete_many({"user_id": uid})
    _db.users.delete_many({"email": {"$regex": "^TEST_"}})


# --- 5. assign_role auto-match by email --------------------------------------
def test_assign_role_auto_matches_by_email(owner_ctx):
    """Preexisting unlinked coach roster row with a specific email; joining
    account with the same email is assigned role=coach (NO athlete_roster_id)
    and must attach to the existing row (linked_id set); exactly ONE row for
    that email should exist after."""
    tag = uuid.uuid4().hex[:6]
    match_email = f"TEST_coach_am_{tag}@t.com"
    # Seed unlinked roster row with the email
    rid = f"rost_am_{tag}"
    _db.roster.insert_one({
        "id": rid, "user_id": owner_ctx["id"],
        "name": f"TEST Existing Coach {tag}", "role": "coach",
        "source": "manual", "email": match_email,
    })
    # New user signs up with THAT email, joins the team (pending)
    jtok, juid = _su(match_email)
    jr = requests.post(f"{B}/team/join", json={"code": owner_ctx["code"]},
                       headers=_h(jtok), timeout=15)
    assert jr.status_code == 200 and jr.json().get("status") == "pending"

    # Assign role coach WITHOUT athlete_roster_id
    before = _db.roster.count_documents(
        {"user_id": owner_ctx["id"], "email": {"$regex": f"^{match_email}$", "$options": "i"}})
    assert before == 1
    r = requests.post(f"{B}/team/members/{juid}/assign-role",
                      json={"role": "coach"}, headers=_h(owner_ctx["tok"]), timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["athlete_roster_id"] == rid  # picked the existing row

    # Existing row is now linked_id=juid and role coach
    row = _db.roster.find_one({"id": rid})
    assert row.get("linked_id") == juid
    assert row.get("role") == "coach"

    # Exactly ONE roster row for that email (no duplicate was created)
    after = _db.roster.count_documents(
        {"user_id": owner_ctx["id"], "email": {"$regex": f"^{match_email}$", "$options": "i"}})
    assert after == 1, f"expected exactly one row for {match_email}, got {after}"


# --- 6. Non-destructive consolidation: share_link re-pointed to survivor ----
def test_consolidation_repoints_share_link(owner_ctx):
    """Survivor roster row + duplicate row (linked_id=user) with an ACTIVE
    share_link on the duplicate. POST assign-role with athlete_roster_id=survivor
    should DELETE duplicate, re-point share_links.ref_id to survivor, and the
    link must still resolve via /public/share/{token}/data."""
    tag = uuid.uuid4().hex[:6]
    joiner_email = f"TEST_ath_cons_{tag}@t.com"

    # Sign up joining account and join team
    jtok, juid = _su(joiner_email)
    requests.post(f"{B}/team/join", json={"code": owner_ctx["code"]},
                  headers=_h(jtok), timeout=15)

    # Seed survivor + duplicate roster rows for the owner
    survivor_id = f"rost_survivor_{tag}"
    dupe_id = f"rost_dupe_{tag}"
    _db.roster.insert_many([
        {"id": survivor_id, "user_id": owner_ctx["id"], "name": f"TEST Survivor {tag}",
         "role": "athlete", "source": "manual"},
        {"id": dupe_id, "user_id": owner_ctx["id"], "name": f"TEST Dupe {tag}",
         "role": "athlete", "source": "manual", "linked_id": juid,
         "email": joiner_email},
    ])

    # Seed active share_link pointing at the DUPLICATE
    from secrets import token_urlsafe
    tok_val = token_urlsafe(9)
    _db.share_links.insert_one({
        "id": f"sl_{tag}", "token": tok_val, "kind": "roster_member",
        "ref_id": dupe_id, "user_id": owner_ctx["id"], "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Assign role athlete with athlete_roster_id=survivor
    r = requests.post(f"{B}/team/members/{juid}/assign-role",
                      json={"role": "athlete", "athlete_roster_id": survivor_id},
                      headers=_h(owner_ctx["tok"]), timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["athlete_roster_id"] == survivor_id

    # Duplicate should be deleted
    assert _db.roster.find_one({"id": dupe_id}) is None, "duplicate row must be deleted"
    # Survivor now linked
    survivor = _db.roster.find_one({"id": survivor_id})
    assert survivor.get("linked_id") == juid

    # share_link re-pointed & still active
    sl = _db.share_links.find_one({"token": tok_val})
    assert sl and sl.get("ref_id") == survivor_id
    assert sl.get("active") is True

    # And the public data endpoint resolves 200 for the same token
    pd = requests.get(f"{B}/public/share/{tok_val}/data", timeout=15)
    assert pd.status_code == 200, f"public data after re-point: {pd.status_code} {pd.text}"
    assert (pd.json().get("member") or {}).get("id") == survivor_id


# --- 7. Auth: assign-role requires owner ------------------------------------
def test_assign_role_requires_owner(owner_ctx):
    tag = uuid.uuid4().hex[:6]
    # A joining user joins the OWNER's team (lands as pending).
    jtok, juid = _su(f"TEST_auth_{tag}@t.com")
    requests.post(f"{B}/team/join", json={"code": owner_ctx["code"]},
                  headers=_h(jtok), timeout=15)

    # Confirm joiner is pending in owner_ctx before the auth attempts.
    owner_hh = _db.households.find_one({"owner_user_id": owner_ctx["id"]})
    tm_before = _db.team_members.find_one(
        {"household_id": owner_hh["id"], "user_id": juid})
    assert tm_before and tm_before.get("status") == "pending"

    # No token -> 401/403 (auth dependency rejects)
    r_noauth = requests.post(f"{B}/team/members/{juid}/assign-role",
                             json={"role": "coach"}, timeout=15)
    assert r_noauth.status_code in (401, 403), r_noauth.status_code

    # Non-owner token: the joiner is not the owner of the target hub. The
    # endpoint is scoped to the caller's active hub, so the joiner's call
    # CANNOT modify their pending record in the owner's hub. Verify the
    # target record is still 'pending' regardless of the response code.
    _r = requests.post(f"{B}/team/members/{juid}/assign-role",
                       json={"role": "coach"}, headers=_h(jtok), timeout=15)
    # The joiner has their own hub (they own it), so this call will operate
    # on THEIR hub, not the owner's. Response is app-specific (may be 200 or
    # 404 depending on whether they exist as a member of their own hub).
    tm_after = _db.team_members.find_one(
        {"household_id": owner_hh["id"], "user_id": juid})
    assert tm_after and tm_after.get("status") == "pending", (
        "non-owner call must NOT flip the joiner's pending status in the "
        f"owner's hub; got: {tm_after}")
