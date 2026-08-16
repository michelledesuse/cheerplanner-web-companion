"""Team Chat Phase 4 — UGC moderation: guidelines gate, profanity filter,
report -> auto-hide, per-user block, admin removal, delete-own."""
import os, uuid, requests
from pymongo import MongoClient

BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"
_mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
_DB = _mc[os.environ.get("DB_NAME", "test_database")]


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _mk_personnel(tag, who):
    tok, uid = _signup(f"{who}_{tag}@t.com")
    return tok, uid


def test_chat_moderation():
    tag = uuid.uuid4().hex[:8]
    o_tok, o_id = _signup(f"owner_{tag}@t.com")
    requests.patch(f"{BASE}/team-access/members/{o_id}", json={"enabled": True}, headers=_h(o_tok))
    # three more personnel in the same household to reach the 3-flag threshold
    flaggers = []
    for i in range(3):
        t, u = _signup(f"mem{i}_{tag}@t.com")
        inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(o_tok)).json()
        requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(t))
        requests.patch(f"{BASE}/team-access/members/{u}", json={"enabled": True}, headers=_h(o_tok))
        flaggers.append((t, u))

    # Guidelines gate: cannot post until accepted.
    assert requests.post(f"{BASE}/team/chat/messages", json={"text": "hi"}, headers=_h(o_tok)).status_code == 403
    m0 = requests.get(f"{BASE}/team/chat/messages", headers=_h(o_tok)).json()
    assert m0["guidelines_accepted"] is False
    assert requests.post(f"{BASE}/team/chat/accept-guidelines", json={}, headers=_h(o_tok)).status_code == 200
    for t, _ in flaggers:
        requests.post(f"{BASE}/team/chat/accept-guidelines", json={}, headers=_h(t))

    # Profanity filter blocks the message.
    bad = requests.post(f"{BASE}/team/chat/messages", json={"text": "you are a bitch"}, headers=_h(o_tok))
    assert bad.status_code == 400, bad.text

    # Clean message posts.
    msg = requests.post(f"{BASE}/team/chat/messages", json={"text": "Practice at 6"}, headers=_h(o_tok)).json()
    mid = msg["id"]

    # 3 distinct reports -> auto-hidden for everyone.
    for t, _ in flaggers:
        assert requests.post(f"{BASE}/team/chat/messages/{mid}/flag", json={"reason": "spam"}, headers=_h(t)).status_code == 200
    seen = requests.get(f"{BASE}/team/chat/messages", headers=_h(flaggers[0][0])).json()["messages"]
    assert not any(m["id"] == mid for m in seen), "auto-hidden message should not appear"

    # Block: flagger0 blocks the owner -> owner's other messages vanish for them.
    requests.post(f"{BASE}/team/chat/messages", json={"text": "Bring water"}, headers=_h(o_tok))
    b_tok = flaggers[0][0]
    requests.post(f"{BASE}/team/chat/block", json={"user_id": o_id}, headers=_h(b_tok))
    after = requests.get(f"{BASE}/team/chat/messages", headers=_h(b_tok)).json()["messages"]
    assert not any(m["sender_id"] == o_id for m in after)
    blocks = requests.get(f"{BASE}/team/chat/blocks", headers=_h(b_tok)).json()["blocks"]
    assert any(x["user_id"] == o_id for x in blocks)
    # Unblock restores.
    requests.post(f"{BASE}/team/chat/unblock", json={"user_id": o_id}, headers=_h(b_tok))
    after2 = requests.get(f"{BASE}/team/chat/messages", headers=_h(b_tok)).json()["messages"]
    assert any(m["sender_id"] == o_id for m in after2)

    # Delete own message; cannot delete someone else's (non-admin).
    mine = requests.post(f"{BASE}/team/chat/messages", json={"text": "delete me"}, headers=_h(b_tok)).json()
    assert requests.delete(f"{BASE}/team/chat/messages/{mine['id']}", headers=_h(b_tok)).status_code == 200
    others = requests.post(f"{BASE}/team/chat/messages", json={"text": "not yours"}, headers=_h(o_tok)).json()
    assert requests.delete(f"{BASE}/team/chat/messages/{others['id']}", headers=_h(b_tok)).status_code == 403

    # Admin can remove any message + see the flag queue.
    _DB["users"].update_one({"id": flaggers[1][1]}, {"$set": {"is_admin": True}})
    admin_tok = flaggers[1][0]
    assert requests.delete(f"{BASE}/team/chat/messages/{others['id']}", headers=_h(admin_tok)).status_code == 200
    flags = requests.get(f"{BASE}/team/chat/flags", headers=_h(admin_tok))
    assert flags.status_code == 200 and "flags" in flags.json()
    # Non-admin blocked from the queue.
    assert requests.get(f"{BASE}/team/chat/flags", headers=_h(o_tok)).status_code == 403
    print("PASS: chat moderation — guidelines/profanity/flag-autohide/block/delete/admin")
