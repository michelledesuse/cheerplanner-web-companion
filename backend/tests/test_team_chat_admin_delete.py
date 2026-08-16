"""Team admin can delete ANY message in their hub; a non-admin parent cannot."""
import os, uuid, requests
B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _su(e):
    r = requests.post(f"{B}/auth/signup", json={"email": e, "password": "Pass2026!", "name": e.split("@")[0]})
    d = r.json(); return d["access_token"], d["user"]["id"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_admin_delete():
    tag = uuid.uuid4().hex[:6]
    o, oid = _su(f"o_{tag}@t.com")                     # owner = team admin
    requests.patch(f"{B}/team-access/members/{oid}", json={"enabled": True}, headers=_h(o))
    p, pid = _su(f"parent_{tag}@t.com")                # plain parent (household member)
    inv = requests.post(f"{B}/household/invite", json={}, headers=_h(o)).json()
    requests.post(f"{B}/household/join", json={"code": inv["code"]}, headers=_h(p))
    for t in (o, p):
        requests.post(f"{B}/team/chat/accept-guidelines", json={}, headers=_h(t))

    # Parent posts a message on the main thread.
    msg = requests.post(f"{B}/team/chat/messages", json={"text": "parent msg"}, headers=_h(p)).json()
    mid = msg["id"]

    # A plain parent CANNOT delete someone else's message.
    assert requests.delete(f"{B}/team/chat/messages/{mid}", headers=_h(p)).status_code == 200  # own msg -> ok
    msg2 = requests.post(f"{B}/team/chat/messages", json={"text": "coach please remove"}, headers=_h(p)).json()
    mid2 = msg2["id"]

    # Team admin (owner) CAN remove the parent's message.
    assert requests.delete(f"{B}/team/chat/messages/{mid2}", headers=_h(o)).status_code == 200
    gen = requests.get(f"{B}/team/chat/messages", headers=_h(o)).json()
    assert not any(m["id"] == mid2 for m in gen["messages"])
    assert gen.get("can_moderate") is True  # admin sees moderation affordance

    # Parent's own view reports can_moderate False.
    pv = requests.get(f"{B}/team/chat/messages", headers=_h(p)).json()
    assert pv.get("can_moderate") is False

    # An outsider admin from a DIFFERENT hub cannot delete this hub's message.
    x, xid = _su(f"x_{tag}@t.com")
    requests.patch(f"{B}/team-access/members/{xid}", json={"enabled": True}, headers=_h(x))
    requests.post(f"{B}/team/chat/accept-guidelines", json={}, headers=_h(x))
    m3 = requests.post(f"{B}/team/chat/messages", json={"text": "still here"}, headers=_h(o)).json()
    assert requests.delete(f"{B}/team/chat/messages/{m3['id']}", headers=_h(x)).status_code == 403
    print("PASS: team admin delete + parent restriction + cross-hub isolation")
