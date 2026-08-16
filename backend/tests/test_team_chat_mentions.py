"""Team Chat Phase 3b — participants list, @mentions, read receipts."""
import os, uuid, time, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_mentions_and_receipts():
    tag = uuid.uuid4().hex[:8]
    o_tok, o_id = _signup(f"owner_{tag}@t.com")
    requests.patch(f"{BASE}/team-access/members/{o_id}", json={"enabled": True}, headers=_h(o_tok))
    m_tok, m_id = _signup(f"mate_{tag}@t.com")
    inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(o_tok)).json()
    requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(m_tok))
    requests.patch(f"{BASE}/team-access/members/{m_id}", json={"enabled": True}, headers=_h(o_tok))
    for t in (o_tok, m_tok):
        requests.post(f"{BASE}/team/chat/accept-guidelines", json={}, headers=_h(t))

    # Participants list excludes yourself, includes the teammate.
    parts = requests.get(f"{BASE}/team/chat/participants", headers=_h(o_tok)).json()["participants"]
    assert any(p["user_id"] == m_id for p in parts)
    assert not any(p["user_id"] == o_id for p in parts)

    # @mention the teammate; invalid ids are dropped.
    msg = requests.post(f"{BASE}/team/chat/messages",
                        json={"text": f"hey @mate_{tag}", "mentions": [m_id, "not-a-real-id"]}, headers=_h(o_tok))
    assert msg.status_code == 200, msg.text
    assert msg.json()["mentions"] == [m_id]
    # Teammate sees the mention on the message.
    lst = requests.get(f"{BASE}/team/chat/messages", headers=_h(m_tok)).json()["messages"]
    assert any(m_id in (x.get("mentions") or []) for x in lst)

    # Read receipts: after teammate reads, their last_read_at >= the message time.
    mid_time = msg.json()["created_at"]
    requests.post(f"{BASE}/team/chat/read", json={}, headers=_h(m_tok))
    rec = requests.get(f"{BASE}/team/chat/receipts", headers=_h(o_tok)).json()["receipts"]
    mate = [r for r in rec if r["user_id"] == m_id][0]
    assert mate["last_read_at"] is not None and mate["last_read_at"] >= mid_time, mate
    print("PASS: participants + mentions + read receipts")
