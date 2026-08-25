"""A parent can be linked to MULTIPLE children in one role assignment, becoming
a recognized guardian on each (fixes multi-kid ParentGuard approval)."""
import os, uuid, requests
from pymongo import MongoClient

B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"
_db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]


def _su(e):
    d = requests.post(f"{B}/auth/signup", json={"email": e, "password": "Pass2026!", "name": e.split("@")[0]}).json()
    return d["access_token"], d["user"]["id"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_parent_links_multiple_children():
    tag = uuid.uuid4().hex[:6]
    owner, oid = _su(f"owner_{tag}@t.com")
    _db.users.update_one({"id": oid}, {"$set": {"team_access": True}})
    requests.get(f"{B}/auth/me", headers=_h(owner))
    code = requests.get(f"{B}/team/join-code", headers=_h(owner)).json()["code"]

    parent_email = f"mom_{tag}@t.com"
    p, pid = _su(parent_email)
    requests.post(f"{B}/team/join", json={"code": code}, headers=_h(p))

    # existing athlete on roster
    a1 = uuid.uuid4().hex
    _db.roster.insert_one({"id": a1, "user_id": oid, "name": "Kid One", "role": "athlete"})

    # Assign parent -> linked to existing Kid One AND a new "Kid Two"
    r = requests.post(f"{B}/team/members/{pid}/assign-role",
                      json={"role": "parent", "athlete_roster_ids": [a1], "athlete_name": "Kid Two"},
                      headers=_h(owner))
    assert r.status_code == 200, r.text
    ids = r.json()["athlete_roster_ids"]
    assert len(ids) == 2, ids

    # Parent is now a recognized guardian (parent_email) on BOTH children.
    for rid in ids:
        doc = _db.roster.find_one({"id": rid})
        emails = {(doc.get("parent_email") or "").lower()} | {
            (c.get("email") or "").lower() for c in (doc.get("caretakers") or [])
        }
        assert parent_email in emails, (rid, emails)

    # Members list shows both children for this parent.
    members = requests.get(f"{B}/team/members", headers=_h(owner)).json()
    prow = next(m for m in members["active"] if m["user_id"] == pid)
    assert "Kid One" in (prow["athlete_name"] or "") and "Kid Two" in (prow["athlete_name"] or ""), prow
    print("PASS: parent linked to multiple children; guardian set on each")
