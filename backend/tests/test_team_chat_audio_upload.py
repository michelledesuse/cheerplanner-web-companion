"""Music (.mp3) uploads must be accepted across MIME aliases and via filename fallback."""
import os, uuid, requests
B = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"

# Minimal valid MP3 frame header + padding (enough bytes to store).
_MP3 = b"\xff\xfb\x90\x64" + b"\x00" * 2048


def _su(e):
    d = requests.post(f"{B}/auth/signup", json={"email": e, "password": "Pass2026!", "name": "u"}).json()
    return d["access_token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def _upload(tok, filename, ctype):
    return requests.post(
        f"{B}/team/chat/media",
        headers=_h(tok),
        files={"file": (filename, _MP3, ctype)},
    )


def test_mp3_aliases_and_fallback():
    tag = uuid.uuid4().hex[:6]
    tok = _su(f"music_{tag}@t.com")
    requests.post(f"{B}/team/chat/accept-guidelines", json={}, headers=_h(tok))

    # 1) The historically-accepted canonical type.
    r1 = _upload(tok, "song.mp3", "audio/mpeg")
    assert r1.status_code == 200, r1.text
    assert r1.json()["kind"] == "audio"

    # 2) The alias that used to FAIL (root cause of the bug report).
    r2 = _upload(tok, "song.mp3", "audio/mp3")
    assert r2.status_code == 200, r2.text
    assert r2.json()["content_type"] == "audio/mpeg"  # normalized to a playable MIME

    # 3) Generic/empty type -> resolved from the .mp3 filename extension.
    r3 = _upload(tok, "beat.mp3", "application/octet-stream")
    assert r3.status_code == 200, r3.text
    assert r3.json()["kind"] == "audio"

    # 4) m4a alias the frontend sends.
    r4 = _upload(tok, "clip.m4a", "audio/m4a")
    assert r4.status_code == 200, r4.text

    # 5) A truly unsupported type is still rejected.
    r5 = _upload(tok, "notes.pdf", "application/pdf")
    assert r5.status_code == 400, r5.text
    print("PASS: mp3 aliases + extension fallback accepted; pdf rejected")
