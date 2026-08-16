"""Team Chat Phase 2 — supervised minor athletes with guardian approval."""
import os, uuid, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_supervised_minor_chat():
    tag = uuid.uuid4().hex[:8]
    guardian_email = f"mom_{tag}@t.com"
    owner_tok, owner_id = _signup(f"owner_{tag}@t.com")
    # Owner becomes team personnel.
    requests.patch(f"{BASE}/team-access/members/{owner_id}", json={"enabled": True}, headers=_h(owner_tok))

    # Add a MINOR athlete to the roster with a guardian (caretaker) email.
    ath = requests.post(f"{BASE}/roster", json={
        "first_name": "Ava", "last_name": "Kid", "role": "athlete", "dob": "01/01/2014",
        "caretakers": [{"first_name": "Mom", "email": guardian_email, "phone": "5551112222"}],
    }, headers=_h(owner_tok))
    assert ath.status_code == 200, ath.text
    roster_id = ath.json()["id"]

    # Athlete list shows the minor, not linked, not enabled.
    lst = requests.get(f"{BASE}/team/chat/athletes", headers=_h(owner_tok)).json()
    row = [a for a in lst["athletes"] if a["roster_id"] == roster_id][0]
    assert row["is_minor"] is True and row["linked"] is False and row["chat_enabled"] is False

    # Coach/owner invites the athlete -> get a code.
    inv = requests.post(f"{BASE}/team/chat/athletes/{roster_id}/invite", json={}, headers=_h(owner_tok))
    assert inv.status_code == 200, inv.text
    code = inv.json()["code"]

    # The minor signs up and redeems the code -> linked but NOT yet enabled.
    minor_tok, minor_id = _signup(f"ava_{tag}@t.com")
    j = requests.post(f"{BASE}/household/join", json={"code": code}, headers=_h(minor_tok))
    assert j.status_code == 200 and j.json().get("chat_athlete") is True, j.text

    # Minor CANNOT chat yet (off by default until guardian approves).
    assert requests.get(f"{BASE}/team/chat/messages", headers=_h(minor_tok)).status_code == 403
    assert requests.post(f"{BASE}/team/chat/messages", json={"text": "hi"}, headers=_h(minor_tok)).status_code == 403

    # A NON-guardian personnel (co-parent member, not a caretaker) cannot approve.
    other_tok, other_id = _signup(f"dad2_{tag}@t.com")
    oinv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(owner_tok)).json()
    requests.post(f"{BASE}/household/join", json={"code": oinv["code"]}, headers=_h(other_tok))
    requests.patch(f"{BASE}/team-access/members/{other_id}", json={"enabled": True}, headers=_h(owner_tok))
    deny = requests.post(f"{BASE}/team/chat/athletes/{roster_id}/approve", json={"enabled": True}, headers=_h(other_tok))
    assert deny.status_code == 403, deny.text

    # The GUARDIAN (a household member whose email matches the caretaker) approves.
    g_tok, g_id = _signup(guardian_email)
    ginv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(owner_tok)).json()
    requests.post(f"{BASE}/household/join", json={"code": ginv["code"]}, headers=_h(g_tok))
    requests.patch(f"{BASE}/team-access/members/{g_id}", json={"enabled": True}, headers=_h(owner_tok))
    ok = requests.post(f"{BASE}/team/chat/athletes/{roster_id}/approve", json={"enabled": True}, headers=_h(g_tok))
    assert ok.status_code == 200 and ok.json()["chat_enabled"] is True, ok.text

    # Now the minor CAN chat, and sees the supervised flag.
    r = requests.get(f"{BASE}/team/chat/messages", headers=_h(minor_tok))
    assert r.status_code == 200 and r.json()["supervised"] is True, r.text
    assert requests.post(f"{BASE}/team/chat/messages", json={"text": "Hi team!"}, headers=_h(minor_tok)).status_code == 200

    # Owner (personnel) sees the minor's message (guardian oversight via the one group thread).
    owner_view = requests.get(f"{BASE}/team/chat/messages", headers=_h(owner_tok)).json()
    assert any(m["text"] == "Hi team!" and m["sender_id"] == minor_id for m in owner_view["messages"])
    assert owner_view["supervised"] is False

    # Guardian can revoke -> minor blocked again.
    requests.post(f"{BASE}/team/chat/athletes/{roster_id}/approve", json={"enabled": False}, headers=_h(g_tok))
    assert requests.get(f"{BASE}/team/chat/messages", headers=_h(minor_tok)).status_code == 403
    print("PASS: supervised minor chat — invite/link/approve/revoke + oversight")
