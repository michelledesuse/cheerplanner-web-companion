"""Team Chat — add an EXISTING family-account login to chat as an athlete."""
import os, uuid, requests
BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json(); return d["access_token"], d["user"]["id"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_link_existing_family_member():
    tag = uuid.uuid4().hex[:8]
    o_tok, o_id = _signup(f"owner_{tag}@t.com")
    requests.patch(f"{BASE}/team-access/members/{o_id}", json={"enabled": True}, headers=_h(o_tok))
    # An athlete who already has a family-account login (household member, no team access).
    kid_tok, kid_id = _signup(f"kid_{tag}@t.com")
    inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(o_tok)).json()
    requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(kid_tok))
    # Roster athlete.
    ath = requests.post(f"{BASE}/roster", json={"first_name": "Bea", "role": "athlete", "dob": "01/01/2013"}, headers=_h(o_tok))
    rid = ath.json()["id"]

    # Family members endpoint lists the kid login.
    fam = requests.get(f"{BASE}/team/chat/family-members", headers=_h(o_tok)).json()["members"]
    assert any(m["user_id"] == kid_id for m in fam)

    # Owner links the existing login directly -> chat enabled, no code.
    lk = requests.post(f"{BASE}/team/chat/athletes/{rid}/link-member", json={"user_id": kid_id}, headers=_h(o_tok))
    assert lk.status_code == 200 and lk.json()["chat_enabled"] is True, lk.text

    # Kid can now chat (after guidelines).
    requests.post(f"{BASE}/team/chat/accept-guidelines", json={}, headers=_h(kid_tok))
    assert requests.get(f"{BASE}/team/chat/messages", headers=_h(kid_tok)).status_code == 200
    assert requests.post(f"{BASE}/team/chat/messages", json={"text": "hi from kid"}, headers=_h(kid_tok)).status_code == 200

    # Linking a non-family user is rejected.
    out_tok, out_id = _signup(f"out_{tag}@t.com")
    bad = requests.post(f"{BASE}/team/chat/athletes/{rid}/link-member", json={"user_id": out_id}, headers=_h(o_tok))
    assert bad.status_code == 400, bad.text
    print("PASS: link existing family member to chat")
