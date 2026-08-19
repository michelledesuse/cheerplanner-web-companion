"""Scheduled group-chat posts: coaches-only gating, list/cancel, and the tick."""
import os, uuid, asyncio, requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"
_db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]


def _su(e):
    d = requests.post(f"{B}/auth/signup", json={"email": e, "password": "Pass2026!", "name": e.split("@")[0]}).json()
    return d["access_token"], d["user"]["id"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_scheduled_posts():
    tag = uuid.uuid4().hex[:6]
    coach, cid = _su(f"coach_{tag}@t.com")
    _db.users.update_one({"id": cid}, {"$set": {"team_access": True}})
    requests.get(f"{B}/auth/me", headers=_h(coach))
    requests.post(f"{B}/team/chat/accept-guidelines", json={}, headers=_h(coach))

    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat().replace("+00:00", "Z")
    r = requests.post(f"{B}/team/chat/scheduled", json={"text": "Practice moved to 6pm", "scheduled_at": when}, headers=_h(coach))
    assert r.status_code == 200, r.text
    sid = r.json()["id"]

    # past-time rejected
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    assert requests.post(f"{B}/team/chat/scheduled", json={"text": "nope", "scheduled_at": past}, headers=_h(coach)).status_code == 400

    # list shows it
    lst = requests.get(f"{B}/team/chat/scheduled", headers=_h(coach)).json()
    assert any(s["id"] == sid and s["text"] == "Practice moved to 6pm" for s in lst["scheduled"]), lst

    # NON-coach (plain member) cannot schedule or list
    m, mid = _su(f"member_{tag}@t.com")
    assert requests.post(f"{B}/team/chat/scheduled", json={"text": "x", "scheduled_at": when}, headers=_h(m)).status_code == 403
    assert requests.get(f"{B}/team/chat/scheduled", headers=_h(m)).status_code == 403

    # cancel
    assert requests.delete(f"{B}/team/chat/scheduled/{sid}", headers=_h(coach)).status_code == 200
    lst2 = requests.get(f"{B}/team/chat/scheduled", headers=_h(coach)).json()
    assert not any(s["id"] == sid for s in lst2["scheduled"])

    # ---- the tick actually posts a DUE message ----
    r2 = requests.post(f"{B}/team/chat/scheduled", json={"text": "Auto-posted!", "scheduled_at": when}, headers=_h(coach))
    sid2 = r2.json()["id"]
    # force it due
    _db.scheduled_messages.update_one({"id": sid2}, {"$set": {"scheduled_at": past}})

    from core.scheduler import send_scheduled_chat_tick
    asyncio.get_event_loop().run_until_complete(send_scheduled_chat_tick())

    doc = _db.scheduled_messages.find_one({"id": sid2})
    assert doc["status"] == "sent", doc.get("status")
    # message now visible in the coach's main thread
    thread = requests.get(f"{B}/team/chat/messages", headers=_h(coach)).json()
    assert any(msg["text"] == "Auto-posted!" and msg["sender_id"] == cid for msg in thread["messages"]), "scheduled post should appear"
    print("PASS: schedule -> gating -> list/cancel -> tick posts due message")
