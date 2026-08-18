"""Team join-code -> pending queue -> role assignment -> profile linking."""
import os, uuid, requests
from pymongo import MongoClient

B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"
_db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]


def _su(e):
    d = requests.post(f"{B}/auth/signup", json={"email": e, "password": "Pass2026!", "name": e.split("@")[0].title()}).json()
    return d["access_token"], d["user"]["id"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_full_flow():
    tag = uuid.uuid4().hex[:6]
    owner, oid = _su(f"owner_{tag}@t.com")
    _db.users.update_one({"id": oid}, {"$set": {"team_access": True}})
    requests.get(f"{B}/auth/me", headers=_h(owner))

    # 1) Owner gets ONE reusable join code (idempotent).
    code = requests.get(f"{B}/team/join-code", headers=_h(owner)).json()["code"]
    assert code and requests.get(f"{B}/team/join-code", headers=_h(owner)).json()["code"] == code

    # 2) Three people join with the same code -> all pending.
    p1, p1id = _su(f"parent_{tag}@t.com")
    c1, c1id = _su(f"coach_{tag}@t.com")
    a1, a1id = _su(f"athlete_{tag}@t.com")
    for tok in (p1, c1, a1):
        r = requests.post(f"{B}/team/join", json={"code": code}, headers=_h(tok))
        assert r.status_code == 200 and r.json()["status"] == "pending", r.text
    # bad code + can't join own team
    assert requests.post(f"{B}/team/join", json={"code": "ZZZZZZ"}, headers=_h(p1)).status_code == 404
    assert requests.post(f"{B}/team/join", json={"code": code}, headers=_h(owner)).status_code == 400

    # 3) Owner sees the New Members list + badge count.
    assert requests.get(f"{B}/team/members/pending-count", headers=_h(owner)).json()["count"] == 3
    members = requests.get(f"{B}/team/members", headers=_h(owner)).json()
    assert len(members["pending"]) == 3 and len(members["active"]) == 0
    # A non-owner sees only THEIR OWN (empty) hub — never the owner's queue.
    p1_view = requests.get(f"{B}/team/members", headers=_h(p1)).json()
    assert p1_view["pending"] == [] and p1_view["active"] == [], p1_view
    assert requests.get(f"{B}/team/members/pending-count", headers=_h(p1)).json()["count"] == 0

    # 4) A pending member gets GROUP-CHAT-ONLY: chat works...
    for tok in (owner, p1):
        requests.post(f"{B}/team/chat/accept-guidelines", json={}, headers=_h(tok))
    msg = requests.post(f"{B}/team/chat/messages", json={"text": "hi team from pending"}, headers=_h(p1))
    assert msg.status_code == 200, msg.text
    owner_thread = requests.get(f"{B}/team/chat/messages", headers=_h(owner)).json()
    assert any(m["text"] == "hi team from pending" for m in owner_thread["messages"]), "owner should see pending member's msg"
    # ...but NOTHING else: team_access-gated endpoints reject a pending member.
    assert requests.get(f"{B}/team/chat/athletes", headers=_h(p1)).status_code == 403

    # 5) Assign COACH -> gets team_access + roster entry, moves to active.
    r = requests.post(f"{B}/team/members/{c1id}/assign-role", json={"role": "coach"}, headers=_h(owner))
    assert r.status_code == 200 and r.json()["status"] == "active", r.text
    assert _db.users.find_one({"id": c1id}).get("team_access") is True
    assert requests.get(f"{B}/team/chat/athletes", headers=_h(c1)).status_code == 200  # coach now has access
    assert _db.roster.find_one({"user_id": oid, "linked_id": c1id, "role": "coach"})

    # 6) Assign ATHLETE (new roster entry) -> roster + chat link.
    r = requests.post(f"{B}/team/members/{a1id}/assign-role",
                      json={"role": "athlete", "athlete_name": "Emma Stone"}, headers=_h(owner))
    assert r.status_code == 200, r.text
    ar = r.json()["athlete_roster_id"]
    assert _db.roster.find_one({"id": ar, "role": "athlete", "name": "Emma Stone"})
    assert _db.athlete_chat_links.find_one({"roster_id": ar, "athlete_user_id": a1id, "chat_enabled": True})

    # 7) Assign PARENT linked to that athlete -> becomes guardian on the roster entry.
    r = requests.post(f"{B}/team/members/{p1id}/assign-role",
                      json={"role": "parent", "athlete_roster_id": ar}, headers=_h(owner))
    assert r.status_code == 200, r.text
    athlete_doc = _db.roster.find_one({"id": ar})
    assert athlete_doc.get("parent_email") == f"parent_{tag}@t.com", athlete_doc.get("parent_email")

    # queue now empty; all three active
    final = requests.get(f"{B}/team/members", headers=_h(owner)).json()
    assert len(final["pending"]) == 0 and len(final["active"]) == 3

    # 8) Remove: owner removes the parent -> gone from queue, chat participation revoked.
    assert requests.post(f"{B}/team/members/{p1id}/remove", headers=_h(owner)).status_code == 200
    assert _db.team_members.find_one({"household_id": _db.households.find_one({'owner_user_id': oid})['id'], "user_id": p1id}) is None
    print("PASS: join code -> pending queue -> chat-only -> role assign/link -> remove")
