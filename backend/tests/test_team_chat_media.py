"""Team Chat Phase 3 — media upload/serve (Object Storage) + reactions."""
import io, os, uuid, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c6360000002000100ffff03000006000557bfabd400"
    "00000049454e44ae426082"
)


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_chat_media_and_reactions():
    tag = uuid.uuid4().hex[:8]
    o_tok, o_id = _signup(f"owner_{tag}@t.com")
    requests.patch(f"{BASE}/team-access/members/{o_id}", json={"enabled": True}, headers=_h(o_tok))
    m_tok, m_id = _signup(f"mate_{tag}@t.com")
    inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(o_tok)).json()
    requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(m_tok))
    requests.patch(f"{BASE}/team-access/members/{m_id}", json={"enabled": True}, headers=_h(o_tok))
    for t in (o_tok, m_tok):
        requests.post(f"{BASE}/team/chat/accept-guidelines", json={}, headers=_h(t))

    # Reject unsupported file type.
    bad = requests.post(f"{BASE}/team/chat/media",
                        files={"file": ("x.txt", io.BytesIO(b"hi"), "text/plain")}, headers=_h(o_tok))
    assert bad.status_code == 400, bad.text

    # Upload a PNG to Object Storage.
    up = requests.post(f"{BASE}/team/chat/media",
                       files={"file": ("pic.png", io.BytesIO(_PNG), "image/png")}, headers=_h(o_tok))
    assert up.status_code == 200, up.text
    media_id = up.json()["media_id"]
    assert up.json()["kind"] == "image"

    # Post a message with the media attached.
    msg = requests.post(f"{BASE}/team/chat/messages", json={"text": "look!", "media_id": media_id}, headers=_h(o_tok))
    assert msg.status_code == 200, msg.text
    mid = msg.json()["id"]
    assert msg.json()["media"] and msg.json()["media"][0]["id"] == media_id

    # A message with ONLY media (no text) is allowed.
    up2 = requests.post(f"{BASE}/team/chat/media",
                        files={"file": ("p2.png", io.BytesIO(_PNG), "image/png")}, headers=_h(o_tok))
    m2 = requests.post(f"{BASE}/team/chat/messages", json={"media_id": up2.json()["media_id"]}, headers=_h(o_tok))
    assert m2.status_code == 200, m2.text

    # Teammate can fetch the media bytes with a ?token=.
    got = requests.get(f"{BASE}/team/chat/media/{media_id}?token={m_tok}")
    assert got.status_code == 200 and got.headers.get("content-type", "").startswith("image/"), got.status_code
    assert got.content == _PNG

    # Outsider (no chat access) cannot fetch.
    x_tok, _ = _signup(f"out_{tag}@t.com")
    assert requests.get(f"{BASE}/team/chat/media/{media_id}?token={x_tok}").status_code == 403
    # Bad/no token -> 401.
    assert requests.get(f"{BASE}/team/chat/media/{media_id}?token=garbage").status_code == 401

    # Reactions: teammate adds 👍, appears; toggling again removes it.
    r1 = requests.post(f"{BASE}/team/chat/messages/{mid}/react", json={"emoji": "👍"}, headers=_h(m_tok))
    assert r1.status_code == 200 and m_id in r1.json()["reactions"]["👍"], r1.text
    # owner also reacts ❤️
    r2 = requests.post(f"{BASE}/team/chat/messages/{mid}/react", json={"emoji": "❤️"}, headers=_h(o_tok))
    assert "❤️" in r2.json()["reactions"]
    # list_messages carries reactions + media
    lst = requests.get(f"{BASE}/team/chat/messages", headers=_h(o_tok)).json()["messages"]
    row = [x for x in lst if x["id"] == mid][0]
    assert row["reactions"]["👍"] == [m_id] and row["media"][0]["id"] == media_id
    # toggle off
    r3 = requests.post(f"{BASE}/team/chat/messages/{mid}/react", json={"emoji": "👍"}, headers=_h(m_tok))
    assert "👍" not in r3.json()["reactions"]
    print("PASS: chat media (object storage) + reactions")
