"""Iter100 — Team Chat Phase 4 moderation (Apple 1.2) tests against the PUBLIC URL.

Covers all backend acceptance criteria from the review request:
(a) guidelines gate 403 -> accept -> 200
(b) profanity filter 400
(c) 3 distinct reports -> auto-hide
(d) block/unblock filtering + /blocks listing
(e) delete own (200) / other non-admin (403)
(f) /flags admin-only (403 non-admin, 200 admin)
"""
import os
import uuid
import time
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"

# Admin account (already flagged is_admin=true in DB per test_credentials.md)
ADMIN_EMAIL = "reviewsadmin@cheerplanner.app"
ADMIN_PASS = "AdminRev2026!"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _signup(email, password="Pass2026!"):
    # Pace signups (endpoint is 10/min per IP)
    for _ in range(3):
        r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": password, "name": email.split("@")[0]}, timeout=20)
        if r.status_code == 429:
            time.sleep(7)
            continue
        return r
    return r


def _login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, (r.status_code, r.text)
    return r.json()["access_token"], r.json()["user"]["id"]


@pytest.fixture(scope="module")
def household():
    """Owner + 3 additional personnel in the same household, all with team_access
    and guidelines accepted (except the owner initially, so we can assert the gate)."""
    tag = uuid.uuid4().hex[:6]
    # owner
    r = _signup(f"owner_{tag}@t.com")
    assert r.status_code == 200, r.text
    o_tok = r.json()["access_token"]
    o_id = r.json()["user"]["id"]
    # ensure owner has team_access (should be default from signup, but be explicit)
    requests.patch(f"{BASE}/team-access/members/{o_id}", json={"enabled": True}, headers=_h(o_tok), timeout=20)

    members = []
    for i in range(3):
        time.sleep(1.5)  # pace under 10/min
        r = _signup(f"mem{i}_{tag}@t.com")
        assert r.status_code == 200, r.text
        t = r.json()["access_token"]
        u = r.json()["user"]["id"]
        inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(o_tok), timeout=20).json()
        assert "code" in inv, inv
        jr = requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(t), timeout=20)
        assert jr.status_code == 200, jr.text
        requests.patch(f"{BASE}/team-access/members/{u}", json={"enabled": True}, headers=_h(o_tok), timeout=20)
        members.append({"tok": t, "id": u})
    return {"owner": {"tok": o_tok, "id": o_id}, "members": members, "tag": tag}


def test_a_guidelines_gate(household):
    o = household["owner"]
    # Before accepting: post => 403 guidelines_not_accepted
    r = requests.post(f"{BASE}/team/chat/messages", json={"text": "hi"}, headers=_h(o["tok"]), timeout=20)
    assert r.status_code == 403, r.text
    assert r.json().get("detail") == "guidelines_not_accepted"
    # GET messages reflects guidelines_accepted=false
    g = requests.get(f"{BASE}/team/chat/messages", headers=_h(o["tok"]), timeout=20).json()
    assert g["guidelines_accepted"] is False
    # Accept
    ar = requests.post(f"{BASE}/team/chat/accept-guidelines", json={}, headers=_h(o["tok"]), timeout=20)
    assert ar.status_code == 200 and ar.json().get("accepted") is True
    # After accepting, clean send works
    r = requests.post(f"{BASE}/team/chat/messages", json={"text": "hello team"}, headers=_h(o["tok"]), timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "hello team"


def test_b_profanity_filter(household):
    o = household["owner"]
    # (owner has already accepted from previous test)
    r = requests.post(f"{BASE}/team/chat/messages", json={"text": "you are a bitch"}, headers=_h(o["tok"]), timeout=20)
    assert r.status_code == 400, r.text


def test_c_three_flags_auto_hide(household):
    o = household["owner"]
    mems = household["members"]
    # Each flagger must accept guidelines first (flag endpoint doesn't require, but posts do — accept for safety)
    for m in mems:
        requests.post(f"{BASE}/team/chat/accept-guidelines", json={}, headers=_h(m["tok"]), timeout=20)
    # Owner posts a clean message
    msg = requests.post(f"{BASE}/team/chat/messages", json={"text": "please flag me"}, headers=_h(o["tok"]), timeout=20).json()
    mid = msg["id"]
    # 3 distinct flags
    for m in mems:
        fr = requests.post(f"{BASE}/team/chat/messages/{mid}/flag", json={"reason": "spam"}, headers=_h(m["tok"]), timeout=20)
        assert fr.status_code == 200, fr.text
    # Should now be hidden for everyone
    seen = requests.get(f"{BASE}/team/chat/messages", headers=_h(mems[0]["tok"]), timeout=20).json()["messages"]
    assert not any(x["id"] == mid for x in seen), "auto-hidden message should not appear"
    seen_o = requests.get(f"{BASE}/team/chat/messages", headers=_h(o["tok"]), timeout=20).json()["messages"]
    assert not any(x["id"] == mid for x in seen_o)


def test_d_block_unblock(household):
    o = household["owner"]
    m0 = household["members"][0]
    # Owner posts a visible message
    requests.post(f"{BASE}/team/chat/messages", json={"text": "visible before block"}, headers=_h(o["tok"]), timeout=20)
    # m0 blocks owner
    br = requests.post(f"{BASE}/team/chat/block", json={"user_id": o["id"]}, headers=_h(m0["tok"]), timeout=20)
    assert br.status_code == 200 and br.json().get("blocked") is True
    after = requests.get(f"{BASE}/team/chat/messages", headers=_h(m0["tok"]), timeout=20).json()["messages"]
    assert not any(x["sender_id"] == o["id"] for x in after), "blocked user's messages should be hidden"
    # /blocks lists owner
    blocks = requests.get(f"{BASE}/team/chat/blocks", headers=_h(m0["tok"]), timeout=20).json()["blocks"]
    assert any(b["user_id"] == o["id"] for b in blocks)
    # Unblock restores
    ur = requests.post(f"{BASE}/team/chat/unblock", json={"user_id": o["id"]}, headers=_h(m0["tok"]), timeout=20)
    assert ur.status_code == 200
    restored = requests.get(f"{BASE}/team/chat/messages", headers=_h(m0["tok"]), timeout=20).json()["messages"]
    assert any(x["sender_id"] == o["id"] for x in restored)


def test_e_delete_permissions(household):
    o = household["owner"]
    m0 = household["members"][0]
    # m0 posts own message and deletes it
    mine = requests.post(f"{BASE}/team/chat/messages", json={"text": "delete me"}, headers=_h(m0["tok"]), timeout=20).json()
    dr = requests.delete(f"{BASE}/team/chat/messages/{mine['id']}", headers=_h(m0["tok"]), timeout=20)
    assert dr.status_code == 200
    # Owner posts; m0 (non-admin) cannot delete
    others = requests.post(f"{BASE}/team/chat/messages", json={"text": "not yours"}, headers=_h(o["tok"]), timeout=20).json()
    dr2 = requests.delete(f"{BASE}/team/chat/messages/{others['id']}", headers=_h(m0["tok"]), timeout=20)
    assert dr2.status_code == 403


def test_f_flags_queue_admin_only(household):
    o = household["owner"]
    # Non-admin -> 403
    r = requests.get(f"{BASE}/team/chat/flags", headers=_h(o["tok"]), timeout=20)
    assert r.status_code == 403, r.text
    # Admin -> 200
    a_tok, _ = _login(ADMIN_EMAIL, ADMIN_PASS)
    r2 = requests.get(f"{BASE}/team/chat/flags", headers=_h(a_tok), timeout=20)
    assert r2.status_code == 200
    assert "flags" in r2.json()
