"""Inline media in Team Hub broadcasts:
- Images (and small videos) are sent inline via MMS (media_url), NOT as links.
- Large videos / other files still fall back to a tap-to-play link.
- send_sms_ex passes media_url to Twilio for MMS.

Uses dry_run only (Twilio is live). inline_media_count is computed from the
attachments regardless of recipients, so it verifies the image/file split.
"""
import base64
import os
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL, PASSWORD = "applereview@cheerplanner.app", "Review2026!"

# tiny 1x1 PNG
_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


def _h():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


def _upload(h, filename, content_type, data_b64):
    r = requests.post(f"{BASE_URL}/api/team/broadcast/attachment",
                      json={"filename": filename, "content_type": content_type, "data_base64": data_b64},
                      headers=h, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _dry(h, tokens):
    p = {"message": "See you Saturday!", "recipients": {"mode": "all"}, "attachment_tokens": tokens,
         "base_url": BASE_URL, "dry_run": True}
    r = requests.post(f"{BASE_URL}/api/team/broadcast/send", json=p, headers=h, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_image_goes_inline_file_goes_link():
    h = _h()
    img = _upload(h, "photo.png", "image/png", _PNG_B64)
    pdf = _upload(h, "form.pdf", "application/pdf", base64.b64encode(b"%PDF-1.4 hello").decode())

    # Image only -> 1 inline media, no trailer link for it.
    d = _dry(h, [img])
    assert d["inline_media_count"] == 1, d
    for pv in d.get("preview", []):
        assert "📎" not in pv["body"], pv

    # PDF only -> 0 inline media (falls back to link).
    d = _dry(h, [pdf])
    assert d["inline_media_count"] == 0, d

    # Mixed -> only the image rides inline.
    d = _dry(h, [img, pdf])
    assert d["inline_media_count"] == 1, d
    print("PASS: image inline (MMS), non-image file -> link fallback")


def test_send_sms_ex_passes_media_url(monkeypatch):
    import core.sms as sms

    captured = {}

    class _FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            class _M: sid = "SM_fake_123"
            return _M()

    class _FakeClient:
        messages = _FakeMessages()

    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+15005550006")
    monkeypatch.setattr(sms, "_get_client", lambda: _FakeClient())

    sid = sms.send_sms_ex("5551234567", "hi", media_urls=["https://x/a.jpg", "https://x/b.jpg"])
    assert sid == "SM_fake_123"
    assert captured["media_url"] == ["https://x/a.jpg", "https://x/b.jpg"], captured

    # No media -> plain SMS (no media_url key).
    captured.clear()
    sms.send_sms_ex("5551234567", "hi")
    assert "media_url" not in captured, captured
    print("PASS: send_sms_ex wires media_url for MMS, omits it for SMS")
