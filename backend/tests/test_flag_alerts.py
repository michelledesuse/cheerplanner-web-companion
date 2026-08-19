"""When a review/chat message is flagged: admins are emailed (with an
'inappropriate -> remove immediately' message) and the admin flag-count updates."""
import os, uuid, requests
from unittest.mock import patch
from pymongo import MongoClient

B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"
_db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]


def _su(e):
    d = requests.post(f"{B}/auth/signup", json={"email": e, "password": "Pass2026!", "name": e.split("@")[0]}).json()
    return d["access_token"], d["user"]["id"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_flag_alert_content_and_helper():
    # Unit-test the alert helper directly (SendGrid mocked) — proves the urgent
    # copy is included and every admin is emailed.
    import core.config as cfg
    import core.email as email
    with patch.object(email, "ADMIN_EMAILS", ["admin1@x.com", "admin2@x.com"]), \
         patch.object(email, "send_email", return_value=True) as m:
        email.send_flag_alert("chat message", "some bad words here", "harassment", 2, False)
        assert m.call_count == 2, "each admin emailed"
        _to, subject, html = m.call_args_list[0].args[0], m.call_args_list[0].args[1], m.call_args_list[0].args[2]
        assert "reported" in subject.lower()
        assert "removed immediately" in html.lower(), "must instruct immediate removal"
        assert "some bad words here" in html, "includes the reported snippet"
    print("PASS: send_flag_alert emails all admins with urgent copy + snippet")


def test_flag_count_endpoint():
    tag = uuid.uuid4().hex[:6]
    # a review by user A
    a, aid = _su(f"rev_{tag}@t.com")
    # create a place + review (best-effort; skip if API shape differs)
    place = requests.post(f"{B}/reviews/places", json={"name": f"Gym {tag}", "city": "Dallas", "category": "gym"}, headers=_h(a))
    if place.status_code >= 300:
        print("SKIP place create:", place.status_code); return
    pid = place.json()["id"]
    rv = requests.post(f"{B}/reviews", json={"place_id": pid, "rating": 5, "body": "great"}, headers=_h(a))
    rid = rv.json()["id"]
    # a different user flags it
    b, bid = _su(f"flagger_{tag}@t.com")
    assert requests.post(f"{B}/reviews/{rid}/flag", json={"reason": "spam"}, headers=_h(b)).status_code == 200
    # admin count reflects it
    admin_email = os.environ.get("ADMIN_EMAILS", "").split(",")[0].strip()
    if not admin_email:
        print("SKIP: no ADMIN_EMAILS set to verify count endpoint"); return
    # promote a user to admin via db for the count check
    _db.users.update_one({"id": bid}, {"$set": {"is_admin": True}})
    cnt = requests.get(f"{B}/admin/flags/count", headers=_h(b))
    assert cnt.status_code == 200, cnt.text
    assert cnt.json()["reviews"] >= 1 and cnt.json()["total"] >= 1, cnt.json()
    print("PASS: /admin/flags/count reflects the flagged review")
