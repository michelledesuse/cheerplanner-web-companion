"""Public share links must be built on the branded host (WEB_FALLBACK_URL),
not the backend's own request host."""
import os, uuid, requests
from core.db import db as _sync  # motor async client — not usable sync; use pymongo below
from pymongo import MongoClient

B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"
_mc = MongoClient(os.environ["MONGO_URL"])
_db = _mc[os.environ.get("DB_NAME", "test_database")]


def _h(t): return {"Authorization": f"Bearer {t}"}


def _mk_premium_coach(tag):
    d = requests.post(f"{B}/auth/signup", json={"email": f"share_{tag}@t.com", "password": "Pass2026!", "name": "Coach"}).json()
    tok, uid = d["access_token"], d["user"]["id"]
    _db.users.update_one({"id": uid}, {"$set": {"team_access": True}})
    # ensure a household exists, then grant a lifetime entitlement on it
    requests.get(f"{B}/auth/me", headers=_h(tok))
    hh = _db.households.find_one({"member_user_ids": uid}) or _db.households.find_one({"owner_id": uid})
    hid = hh["id"] if hh else uid
    _db.entitlements.insert_one({
        "id": uuid.uuid4().hex, "type": "lifetime", "status": "active",
        "household_id": hid, "source": "test", "created_at": "2026-01-01T00:00:00Z",
    })
    return tok, uid


def test_share_links_use_branded_host():
    tag = uuid.uuid4().hex[:6]
    tok, uid = _mk_premium_coach(tag)

    r = requests.post(f"{B}/team/share", headers=_h(tok), json={"kind": "roster", "ref_id": None})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"].startswith("https://cheer-planner.com/api/public/s/"), body
    assert body["url"].endswith(body["token"])

    # Reusing the same link returns the same branded URL.
    r2 = requests.post(f"{B}/team/share", headers=_h(tok), json={"kind": "roster", "ref_id": None})
    assert r2.json()["url"] == body["url"]

    # request-info also returns a branded URL and ignores any client base_url.
    m = {"id": uuid.uuid4().hex, "user_id": uid, "name": "Kid One", "first_name": "Kid", "last_name": "One", "role": "athlete"}
    _db.roster.insert_one(dict(m))
    ri = requests.post(f"{B}/team/roster/{m['id']}/request-info",
                       headers=_h(tok), json={"base_url": "https://evil.example.com", "send": False})
    assert ri.status_code == 200, ri.text
    assert ri.json()["url"].startswith("https://cheer-planner.com/api/public/s/"), ri.json()

    # cleanup
    _db.entitlements.delete_many({"household_id": {"$in": [uid]}})
    _db.roster.delete_many({"user_id": uid})
    _db.users.delete_one({"id": uid})
    print("PASS: branded share links")
