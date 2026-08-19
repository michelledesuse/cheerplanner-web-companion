"""Media download endpoint: token gating + 206 range + 404 for bad id."""
import os, uuid, io, requests

B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _su(email):
    d = requests.post(f"{B}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]}).json()
    return d["access_token"], d["user"]["id"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_media_download_gating_and_range():
    tag = uuid.uuid4().hex[:6]
    tok, uid = _su(f"media_{tag}@t.com")
    # accept guidelines
    requests.post(f"{B}/team/chat/accept-guidelines", json={}, headers=_h(tok))
    # upload a small JPEG (2-byte JPEG magic is enough for MIME sniff but let's send a real 1x1 PNG)
    png_bytes = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c62000100000005000101a5f645960000000049454e44ae426082"
    )
    files = {"file": ("t.png", io.BytesIO(png_bytes), "image/png")}
    r = requests.post(f"{B}/team/chat/media", files=files, headers=_h(tok))
    assert r.status_code == 200, r.text
    media_id = r.json()["media_id"]

    # No token -> 422 (Query required) or 401
    r0 = requests.get(f"{B}/team/chat/media/{media_id}")
    assert r0.status_code in (401, 422), r0.status_code

    # Bad token -> 401
    r1 = requests.get(f"{B}/team/chat/media/{media_id}?token=notavalidtoken")
    assert r1.status_code == 401, r1.status_code

    # Valid token -> 200 (no Range header)
    r2 = requests.get(f"{B}/team/chat/media/{media_id}?token={tok}")
    assert r2.status_code == 200, r2.status_code
    assert r2.headers.get("Accept-Ranges") == "bytes"
    assert int(r2.headers.get("Content-Length", "0")) == len(png_bytes)

    # Valid token + Range -> 206
    r3 = requests.get(f"{B}/team/chat/media/{media_id}?token={tok}", headers={"Range": "bytes=0-4"})
    assert r3.status_code == 206, r3.status_code
    assert r3.headers.get("Content-Range", "").startswith("bytes 0-4/")

    # Non-participant token -> 403
    tok2, _ = _su(f"other_{tag}@t.com")
    r4 = requests.get(f"{B}/team/chat/media/{media_id}?token={tok2}")
    assert r4.status_code == 403, r4.status_code

    # Bad media id -> 404
    r5 = requests.get(f"{B}/team/chat/media/does_not_exist?token={tok}")
    assert r5.status_code == 404, r5.status_code
    print("PASS: media download gating + range OK")
