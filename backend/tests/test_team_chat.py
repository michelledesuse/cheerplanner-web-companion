"""Team Hub Phase-1 chat: post/list, unread counts, read receipts, pagination,
and household isolation. All participants must have team_access."""
import os, uuid, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _grant_access(owner_tok, uid):
    r = requests.patch(f"{BASE}/team-access/members/{uid}", json={"enabled": True}, headers=_h(owner_tok))
    assert r.status_code == 200, r.text


def test_team_chat_flow():
    tag = uuid.uuid4().hex[:8]
    o_tok, o_id = _signup(f"owner_{tag}@t.com")
    m_tok, m_id = _signup(f"coach_{tag}@t.com")
    x_tok, x_id = _signup(f"outsider_{tag}@t.com")

    # Coach joins owner's household, then both become team personnel.
    inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(o_tok)).json()
    assert requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(m_tok)).status_code == 200
    _grant_access(o_tok, o_id)
    _grant_access(o_tok, m_id)
    _grant_access(x_tok, x_id)  # outsider owns their own hub
    # Accept chat guidelines (Apple 1.2 gate) before posting.
    for t in (o_tok, m_tok, x_tok):
        requests.post(f"{BASE}/team/chat/accept-guidelines", json={}, headers=_h(t))

    # Gate: a login without team_access is blocked.
    _no_tok, _ = _signup(f"noaccess_{tag}@t.com")
    assert requests.get(f"{BASE}/team/chat/messages", headers=_h(_no_tok)).status_code == 403

    # Owner posts -> coach sees it and has 1 unread.
    r = requests.post(f"{BASE}/team/chat/messages", json={"text": "Hello team!"}, headers=_h(o_tok))
    assert r.status_code == 200 and r.json()["sender_id"] == o_id
    lst = requests.get(f"{BASE}/team/chat/messages", headers=_h(m_tok)).json()
    assert len(lst["messages"]) == 1 and lst["messages"][0]["text"] == "Hello team!"
    assert lst["me"] == m_id
    assert requests.get(f"{BASE}/team/chat/unread", headers=_h(m_tok)).json()["unread"] == 1
    # Owner has 0 unread (their own message).
    assert requests.get(f"{BASE}/team/chat/unread", headers=_h(o_tok)).json()["unread"] == 0

    # Coach reads -> unread clears; coach replies -> owner has 1 unread.
    requests.post(f"{BASE}/team/chat/read", json={}, headers=_h(m_tok))
    assert requests.get(f"{BASE}/team/chat/unread", headers=_h(m_tok)).json()["unread"] == 0
    requests.post(f"{BASE}/team/chat/messages", json={"text": "Hi coach here"}, headers=_h(m_tok))
    assert requests.get(f"{BASE}/team/chat/unread", headers=_h(o_tok)).json()["unread"] == 1

    # Empty message rejected.
    assert requests.post(f"{BASE}/team/chat/messages", json={"text": "   "}, headers=_h(o_tok)).status_code == 400

    # Household isolation: outsider sees none of it.
    assert requests.get(f"{BASE}/team/chat/messages", headers=_h(x_tok)).json()["messages"] == []
    assert requests.get(f"{BASE}/team/chat/unread", headers=_h(x_tok)).json()["unread"] == 0

    # Pagination: push to 45 total, first page = 40 + has_more, older page returns the rest.
    for i in range(43):
        requests.post(f"{BASE}/team/chat/messages", json={"text": f"msg {i}"}, headers=_h(o_tok))
    page1 = requests.get(f"{BASE}/team/chat/messages?limit=40", headers=_h(m_tok)).json()
    assert len(page1["messages"]) == 40 and page1["has_more"] is True
    oldest = page1["messages"][0]["created_at"]
    page2 = requests.get(f"{BASE}/team/chat/messages?limit=40&before={oldest}", headers=_h(m_tok)).json()
    assert len(page2["messages"]) == 5 and page2["has_more"] is False  # 45 - 40 = 5
    print("PASS: team chat post/list/unread/read/pagination/isolation")
