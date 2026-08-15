"""Activity feed: notifies OTHER members when a competition/event is added or
changed; clears on view (resource_id) and via mark-all-seen. Plus admin lifetime
list + revoke."""
import os, uuid, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_activity_feed():
    tag = uuid.uuid4().hex[:8]
    owner_tok, owner_id = _signup(f"a_{tag}@t.com")
    m_tok, m_id = _signup(f"b_{tag}@t.com")
    inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(owner_tok)).json()
    requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(m_tok))

    # Owner adds a competition + a schedule event.
    c = requests.post(f"{BASE}/competitions", json={"name": "Nationals", "event_date": "2026-10-01"}, headers=_h(owner_tok))
    cid = c.json()["id"]
    requests.post(f"{BASE}/schedule", json={"title": "Practice", "event_type": "practice", "date": "2026-10-02"}, headers=_h(owner_tok))

    # Member sees 2 unseen items; actor (owner) sees none of their own.
    m_feed = requests.get(f"{BASE}/activity", headers=_h(m_tok)).json()
    assert m_feed["count"] == 2, m_feed
    kinds = {(i["resource"], i["action"]) for i in m_feed["items"]}
    assert ("competition", "added") in kinds and ("event", "added") in kinds
    assert all(i["actor_name"] for i in m_feed["items"])
    assert requests.get(f"{BASE}/activity", headers=_h(owner_tok)).json()["count"] == 0

    # Clear ONE item by viewing it (resource_id).
    requests.post(f"{BASE}/activity/mark-seen", json={"resource_id": cid}, headers=_h(m_tok))
    assert requests.get(f"{BASE}/activity", headers=_h(m_tok)).json()["count"] == 1

    # Owner updates competition -> member sees it again.
    requests.patch(f"{BASE}/competitions/{cid}", json={"location": "Dallas"}, headers=_h(owner_tok))
    assert requests.get(f"{BASE}/activity", headers=_h(m_tok)).json()["count"] == 2

    # Mark all seen -> empty.
    requests.post(f"{BASE}/activity/mark-seen", json={"all": True}, headers=_h(m_tok))
    assert requests.get(f"{BASE}/activity", headers=_h(m_tok)).json()["count"] == 0

    # Member's own add does NOT notify themselves.
    requests.post(f"{BASE}/competitions", json={"name": "Regionals", "event_date": "2026-11-01"}, headers=_h(m_tok))
    assert requests.get(f"{BASE}/activity", headers=_h(m_tok)).json()["count"] == 0
    # ...but the owner now sees the member's add.
    assert requests.get(f"{BASE}/activity", headers=_h(owner_tok)).json()["count"] == 1
    print("PASS: activity feed notify/clear works")


def test_solo_household_no_activity():
    tag = uuid.uuid4().hex[:8]
    tok, _ = _signup(f"solo_{tag}@t.com")
    requests.post(f"{BASE}/competitions", json={"name": "Solo Comp", "event_date": "2026-10-01"}, headers=_h(tok))
    assert requests.get(f"{BASE}/activity", headers=_h(tok)).json()["count"] == 0
    print("PASS: solo household gets no activity noise")


def test_admin_lifetime_list_and_revoke():
    # Admin account (seeded is_admin from ADMIN_EMAILS). Use the reviews admin? No —
    # use cheerplanner@gmail.com path isn't available; instead flag a fresh user via
    # self-premium requires admin. We rely on an existing admin login.
    import pymongo  # noqa
    # Create a fresh user, then flag admin directly in DB for the test.
    tag = uuid.uuid4().hex[:8]
    admin_tok, admin_id = _signup(f"adm_{tag}@t.com")
    from motor.motor_asyncio import AsyncIOMotorClient  # noqa
    import asyncio
    from pymongo import MongoClient
    import os as _os
    mc = MongoClient(_os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    dbname = _os.environ.get("DB_NAME", "test_database")
    mc[dbname]["users"].update_one({"id": admin_id}, {"$set": {"is_admin": True}})

    # Grant lifetime to a target user.
    target_tok, target_id = _signup(f"life_{tag}@t.com")
    g = requests.post(f"{BASE}/admin/lifetime/grant", json={"user_id": target_id, "reason": "Test", "label": "Founder"}, headers=_h(admin_tok))
    assert g.status_code == 200, g.text
    ent_id = g.json()["entitlement_id"]

    # List shows the target with granted_at + email.
    lst = requests.get(f"{BASE}/admin/lifetime", headers=_h(admin_tok)).json()
    match = [x for x in lst["lifetime"] if x["entitlement_id"] == ent_id]
    assert match and match[0]["email"] == f"life_{tag}@t.com" and match[0]["granted_at"], lst
    assert match[0]["label"] == "Founder"

    # Revoke -> disappears from list.
    rv = requests.post(f"{BASE}/admin/lifetime/revoke", json={"entitlement_id": ent_id}, headers=_h(admin_tok))
    assert rv.status_code == 200, rv.text
    lst2 = requests.get(f"{BASE}/admin/lifetime", headers=_h(admin_tok)).json()
    assert not [x for x in lst2["lifetime"] if x["entitlement_id"] == ent_id]

    # Non-admin gets 403.
    assert requests.get(f"{BASE}/admin/lifetime", headers=_h(target_tok)).status_code == 403
    print("PASS: admin lifetime list + revoke works")
