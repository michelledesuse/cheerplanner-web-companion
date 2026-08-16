"""Named chats (channels): create, list, per-channel post, and permission model."""
import os, uuid, requests
B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _su(e):
    r = requests.post(f"{B}/auth/signup", json={"email": e, "password": "Pass2026!", "name": e.split("@")[0]})
    d = r.json(); return d["access_token"], d["user"]["id"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_named_channels():
    tag = uuid.uuid4().hex[:6]
    o, oid = _su(f"o_{tag}@t.com")
    requests.patch(f"{B}/team-access/members/{oid}", json={"enabled": True}, headers=_h(o))
    # a co-parent (household member, NOT personnel)
    p, pid = _su(f"parent_{tag}@t.com")
    inv = requests.post(f"{B}/household/invite", json={}, headers=_h(o)).json()
    requests.post(f"{B}/household/join", json={"code": inv["code"]}, headers=_h(p))
    for t in (o, p):
        requests.post(f"{B}/team/chat/accept-guidelines", json={}, headers=_h(t))

    # Parent creates a chat with the coach/owner.
    ch = requests.post(f"{B}/team/chat/channels", json={"name": "Fundraising", "member_ids": [oid]}, headers=_h(p))
    assert ch.status_code == 200, ch.text
    cid = ch.json()["id"]

    # Owner (team admin) can SEE the parent-created channel (oversight), even though not explicitly added? creator added owner, so member. Verify admin sees ALL: create one WITHOUT owner.
    ch2 = requests.post(f"{B}/team/chat/channels", json={"name": "Parents only", "member_ids": []}, headers=_h(p))
    cid2 = ch2.json()["id"]
    admin_list = {c["id"] for c in requests.get(f"{B}/team/chat/channels", headers=_h(o)).json()["channels"]}
    assert cid in admin_list and cid2 in admin_list, "admin must see all channels"

    # Parent posts in their channel; owner can read it.
    assert requests.post(f"{B}/team/chat/channels/{cid}/messages", json={"text": "hi coach"}, headers=_h(p)).status_code == 200
    msgs = requests.get(f"{B}/team/chat/channels/{cid}/messages", headers=_h(o)).json()["messages"]
    assert any(m["text"] == "hi coach" for m in msgs)

    # An outsider (own hub) can't see or post.
    x, xid = _su(f"x_{tag}@t.com")
    requests.patch(f"{B}/team-access/members/{xid}", json={"enabled": True}, headers=_h(x))
    assert requests.get(f"{B}/team/chat/channels/{cid}/messages", headers=_h(x)).status_code in (403, 404)

    # Channel messages do NOT appear in the general thread.
    gen = requests.get(f"{B}/team/chat/messages", headers=_h(o)).json()["messages"]
    assert not any(m["text"] == "hi coach" for m in gen)
    print("PASS: named channels create/list/post/permissions")
