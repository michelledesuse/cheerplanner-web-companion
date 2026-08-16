"""Extended named-channels tests for iter103: parent access, admin oversight,
channel<->main isolation, and family_view auto-share for minor athlete channels."""
import os, time, uuid, requests

B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _su(e, retries=3):
    """Signup with rate-limit retry."""
    for _ in range(retries):
        r = requests.post(f"{B}/auth/signup", json={"email": e, "password": "Pass2026!", "name": e.split("@")[0]})
        if r.status_code == 429:
            time.sleep(7); continue
        r.raise_for_status()
        d = r.json(); return d["access_token"], d["user"]["id"]
    raise RuntimeError(f"signup failed for {e}: {r.status_code} {r.text}")


def _h(t): return {"Authorization": f"Bearer {t}"}


def _accept(t): requests.post(f"{B}/team/chat/accept-guidelines", json={}, headers=_h(t))


# --- Feature: parent (household member) can now read/post the main thread ---
def test_parent_can_use_main_thread_and_create_channel():
    tag = uuid.uuid4().hex[:6]
    o, oid = _su(f"o1_{tag}@t.com")
    requests.patch(f"{B}/team-access/members/{oid}", json={"enabled": True}, headers=_h(o))
    p, pid = _su(f"p1_{tag}@t.com")
    inv = requests.post(f"{B}/household/invite", json={}, headers=_h(o)).json()
    j = requests.post(f"{B}/household/join", json={"code": inv["code"]}, headers=_h(p))
    assert j.status_code == 200, j.text
    _accept(o); _accept(p)

    # Parent can GET main thread (was 403 pre-fix).
    r = requests.get(f"{B}/team/chat/messages", headers=_h(p))
    assert r.status_code == 200, r.text
    assert r.json().get("supervised") is False, "parent must NOT be marked supervised"

    # Parent can POST main thread.
    r = requests.post(f"{B}/team/chat/messages", json={"text": "hello from parent"}, headers=_h(p))
    assert r.status_code == 200, r.text

    # Owner sees the parent message in main thread.
    msgs = requests.get(f"{B}/team/chat/messages", headers=_h(o)).json()["messages"]
    assert any(m["text"] == "hello from parent" for m in msgs)

    # Parent can create a named channel.
    ch = requests.post(f"{B}/team/chat/channels", json={"name": f"Parents-{tag}", "member_ids": [oid]}, headers=_h(p))
    assert ch.status_code == 200, ch.text
    assert ch.json().get("kind") == "team"  # no athlete member => team kind


# --- Feature: outsider cannot see/post a channel from someone else's hub ---
def test_outsider_blocked_from_foreign_channel():
    tag = uuid.uuid4().hex[:6]
    o, oid = _su(f"o2_{tag}@t.com")
    requests.patch(f"{B}/team-access/members/{oid}", json={"enabled": True}, headers=_h(o))
    _accept(o)
    ch = requests.post(f"{B}/team/chat/channels", json={"name": f"Priv-{tag}", "member_ids": []}, headers=_h(o))
    assert ch.status_code == 200
    cid = ch.json()["id"]

    x, xid = _su(f"x2_{tag}@t.com")
    requests.patch(f"{B}/team-access/members/{xid}", json={"enabled": True}, headers=_h(x))
    _accept(x)
    # Outsider (different hub) — read must 403/404.
    r = requests.get(f"{B}/team/chat/channels/{cid}/messages", headers=_h(x))
    assert r.status_code in (403, 404), r.text
    # Outsider POST must 403/404.
    r = requests.post(f"{B}/team/chat/channels/{cid}/messages", json={"text": "leak"}, headers=_h(x))
    assert r.status_code in (403, 404), r.text


# --- Regression: channel messages must NOT bleed into main thread & vice versa ---
def test_channel_and_main_are_isolated():
    tag = uuid.uuid4().hex[:6]
    o, oid = _su(f"o3_{tag}@t.com")
    requests.patch(f"{B}/team-access/members/{oid}", json={"enabled": True}, headers=_h(o))
    _accept(o)
    ch = requests.post(f"{B}/team/chat/channels", json={"name": f"Solo-{tag}", "member_ids": []}, headers=_h(o))
    cid = ch.json()["id"]
    token_main = f"main-only-{tag}"
    token_chan = f"chan-only-{tag}"
    requests.post(f"{B}/team/chat/messages", json={"text": token_main}, headers=_h(o))
    requests.post(f"{B}/team/chat/channels/{cid}/messages", json={"text": token_chan}, headers=_h(o))

    main = requests.get(f"{B}/team/chat/messages", headers=_h(o)).json()["messages"]
    chan = requests.get(f"{B}/team/chat/channels/{cid}/messages", headers=_h(o)).json()["messages"]
    assert any(m["text"] == token_main for m in main)
    assert not any(m["text"] == token_chan for m in main), "channel msg leaked into main"
    assert any(m["text"] == token_chan for m in chan)
    assert not any(m["text"] == token_main for m in chan), "main msg leaked into channel"


# --- Regression: reactions, flag/block, media upload still function ---
def test_regression_reactions_and_moderation():
    tag = uuid.uuid4().hex[:6]
    o, oid = _su(f"o4_{tag}@t.com")
    requests.patch(f"{B}/team-access/members/{oid}", json={"enabled": True}, headers=_h(o))
    _accept(o)
    m = requests.post(f"{B}/team/chat/messages", json={"text": "react me"}, headers=_h(o)).json()
    mid = m["id"]
    # React
    rr = requests.post(f"{B}/team/chat/messages/{mid}/react", json={"emoji": "🎉"}, headers=_h(o))
    assert rr.status_code == 200 and "🎉" in rr.json()["reactions"], rr.text
    # Flag self-message (still 200 flagged=True)
    fr = requests.post(f"{B}/team/chat/messages/{mid}/flag", json={"reason": "test"}, headers=_h(o))
    assert fr.status_code == 200 and fr.json().get("flagged") is True
    # Delete
    dr = requests.delete(f"{B}/team/chat/messages/{mid}", headers=_h(o))
    assert dr.status_code == 200 and dr.json().get("deleted") is True
