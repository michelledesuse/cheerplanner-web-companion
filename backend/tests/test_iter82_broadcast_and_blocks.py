"""Iter 82 — Broadcast text feature (dry_run) + Manage-access sheet blocks.

CRITICAL: Only dry_run=True is exercised for send. Twilio is LIVE."""
import base64
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://event-planner-394.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"

AVA_ID = "BC_TEST_d7f553"      # Ava, parent Jamie 5550001111
MIA_ID = "BC_TEST_1fcf18"      # Mia, parent Robin 5550002222
NOPHONE_ID = "BC_TEST_7b2078"  # No phone
TRACK_ID = "BCMUS_TEST_116a69"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _payload(**over):
    p = {
        "message": "Reminder: comp Saturday!",
        "recipients": {"mode": "all"},
        "links": [],
        "track_ids": [],
        "attachment_tokens": [],
        "base_url": BASE_URL,
        "dry_run": True,
    }
    p.update(over)
    return p


# -------------------- Broadcast dry_run --------------------
class TestBroadcastDryRun:
    def test_mode_all_counts_and_greeting(self, h):
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send", json=_payload(), headers=h, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # 2 unique phones (5550001111, 5550002222). NoPhone is skipped.
        assert data["recipient_count"] >= 2, data
        assert data["no_phone_count"] >= 1
        assert "NoPhone Kid" in data.get("no_phone", []) or any("NoPhone" in x for x in data.get("no_phone", []))
        # every preview greets with parent first name
        names_seen = set()
        for pv in data["preview"]:
            assert pv["body"].startswith(f"Hi {pv['name']},"), pv
            names_seen.add(pv["name"])
        # Should include Jamie and Robin (parent first names)
        assert {"Jamie", "Robin"}.issubset(names_seen), names_seen

    def test_mode_members_filter(self, h):
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send",
                          json=_payload(recipients={"mode": "members", "member_ids": [AVA_ID]}),
                          headers=h, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["recipient_count"] == 1
        assert d["preview"][0]["name"] == "Jamie"
        assert d["preview"][0]["body"].startswith("Hi Jamie, Reminder:")

    def test_mode_members_dedupe_and_no_phone(self, h):
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send",
                          json=_payload(recipients={"mode": "members", "member_ids": [AVA_ID, MIA_ID, NOPHONE_ID]}),
                          headers=h, timeout=20)
        d = r.json()
        assert d["recipient_count"] == 2
        assert d["no_phone_count"] == 1

    def test_mode_team_with_no_team_matches_returns_zero(self, h):
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send",
                          json=_payload(recipients={"mode": "team", "team_id": "team-does-not-exist"}),
                          headers=h, timeout=20)
        assert r.status_code == 200
        assert r.json()["recipient_count"] == 0

    def test_links_appended(self, h):
        links = [{"label": "Waiver", "url": "https://example.com/w"},
                 {"label": "", "url": "https://example.com/x"}]
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send",
                          json=_payload(recipients={"mode": "members", "member_ids": [AVA_ID]}, links=links),
                          headers=h, timeout=20)
        body = r.json()["preview"][0]["body"]
        assert "Waiver: https://example.com/w" in body
        assert "https://example.com/x" in body

    def test_music_link_appended(self, h):
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send",
                          json=_payload(recipients={"mode": "members", "member_ids": [AVA_ID]}, track_ids=[TRACK_ID]),
                          headers=h, timeout=20)
        body = r.json()["preview"][0]["body"]
        assert "🎵" in body
        m = re.search(r"/api/public/media/([A-Za-z0-9_\-]+)", body)
        assert m, body
        return m.group(1)  # for reuse

    def test_empty_message_and_no_extras_400s(self, h):
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send",
                          json=_payload(message="", links=[], track_ids=[], attachment_tokens=[]),
                          headers=h, timeout=20)
        assert r.status_code == 400

    def test_base_url_required_https(self, h):
        p = _payload()
        p["base_url"] = "http://insecure"
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send", json=p, headers=h, timeout=20)
        assert r.status_code == 400


# -------------------- Attachment upload + public media --------------------
# tiny 1x1 PNG
_PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


class TestAttachmentsAndPublic:
    token_val = None

    def test_upload_attachment(self, h):
        payload = {"filename": "TEST_pic.png", "content_type": "image/png", "data_base64": _PNG_B64}
        r = requests.post(f"{BASE_URL}/api/team/broadcast/attachment", json=payload, headers=h, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "token" in d and d["filename"] == "TEST_pic.png"
        assert d["size"] > 0
        TestAttachmentsAndPublic.token_val = d["token"]

    def test_public_media_html(self):
        tok = TestAttachmentsAndPublic.token_val
        r = requests.get(f"{BASE_URL}/api/public/media/{tok}", timeout=20)
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        assert "<img" in r.text or "TEST_pic" in r.text

    def test_public_media_raw(self):
        tok = TestAttachmentsAndPublic.token_val
        r = requests.get(f"{BASE_URL}/api/public/media/{tok}/raw", timeout=20)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")
        assert len(r.content) > 0

    def test_public_media_raw_range_206(self):
        tok = TestAttachmentsAndPublic.token_val
        r = requests.get(f"{BASE_URL}/api/public/media/{tok}/raw",
                         headers={"Range": "bytes=0-4"}, timeout=20)
        assert r.status_code == 206
        assert "content-range" in {k.lower() for k in r.headers.keys()}
        assert len(r.content) == 5

    def test_attachment_appears_in_broadcast_trailer(self, h):
        tok = TestAttachmentsAndPublic.token_val
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send",
                          json=_payload(recipients={"mode": "members", "member_ids": [AVA_ID]},
                                        attachment_tokens=[tok]),
                          headers=h, timeout=20)
        body = r.json()["preview"][0]["body"]
        assert "📎" in body and tok in body

    def test_bad_base64_400s(self, h):
        r = requests.post(f"{BASE_URL}/api/team/broadcast/attachment",
                          json={"filename": "x", "data_base64": "!!not-base64!!"}, headers=h, timeout=20)
        assert r.status_code == 400


# -------------------- Music public link (no auth) --------------------
class TestMusicPublicLink:
    def test_music_public_page_and_range(self, h):
        # Get music public url via a dry-run first (creates public_media doc)
        r = requests.post(f"{BASE_URL}/api/team/broadcast/send",
                          json=_payload(recipients={"mode": "members", "member_ids": [AVA_ID]},
                                        track_ids=[TRACK_ID]), headers=h, timeout=20)
        body = r.json()["preview"][0]["body"]
        m = re.search(r"/api/public/media/([A-Za-z0-9_\-]+)", body)
        assert m
        tok = m.group(1)
        # HTML page (no auth headers)
        page = requests.get(f"{BASE_URL}/api/public/media/{tok}", timeout=20)
        assert page.status_code == 200
        assert "<audio" in page.text
        # Range on raw
        raw = requests.get(f"{BASE_URL}/api/public/media/{tok}/raw",
                           headers={"Range": "bytes=0-99"}, timeout=20)
        assert raw.status_code == 206
        assert raw.headers.get("Accept-Ranges", "").lower() == "bytes"


# -------------------- Blocks (owner-only manage-access) --------------------
class TestBlocks:
    def test_get_blocks_owner_solo_household(self, h):
        # Solo household -> is_owner True, members empty (blocked_user_ids also empty)
        r = requests.get(f"{BASE_URL}/api/team/blocks/payment/TEST_tracker_id", headers=h, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_owner"] is True
        assert d["members"] == []
        assert d["blocked_user_ids"] == []

    def test_put_block_rejects_non_member(self, h):
        body = {"blocked_user_id": "nonexistent-user", "resource": "payment", "resource_id": "TEST_tracker_id"}
        r = requests.put(f"{BASE_URL}/api/team/blocks?blocked=true", json=body, headers=h, timeout=20)
        assert r.status_code == 404, r.text

    def test_put_block_self_persist_and_clear(self, h):
        # The owner is inside their own member_user_ids -> PUT allowed. Then GET shows blocked_user_ids.
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=20).json()
        uid = me["id"]
        body = {"blocked_user_id": uid, "resource": "payment", "resource_id": "TEST_block_flow"}
        r = requests.put(f"{BASE_URL}/api/team/blocks?blocked=true", json=body, headers=h, timeout=20)
        assert r.status_code == 200 and r.json()["blocked"] is True
        # persistence check via GET
        g = requests.get(f"{BASE_URL}/api/team/blocks/payment/TEST_block_flow", headers=h, timeout=20).json()
        assert uid in g["blocked_user_ids"]
        # clear
        r2 = requests.put(f"{BASE_URL}/api/team/blocks?blocked=false", json=body, headers=h, timeout=20)
        assert r2.status_code == 200 and r2.json()["blocked"] is False
        g2 = requests.get(f"{BASE_URL}/api/team/blocks/payment/TEST_block_flow", headers=h, timeout=20).json()
        assert uid not in g2["blocked_user_ids"]

    def test_all_resource_kinds_contract(self, h):
        # GET should not 404 for any resource kind (no resource_id validation server-side)
        for res in ["payment", "signup", "paperwork", "attendance"]:
            r = requests.get(f"{BASE_URL}/api/team/blocks/{res}/some-id", headers=h, timeout=20)
            assert r.status_code == 200, (res, r.text)
            j = r.json()
            assert "is_owner" in j and "members" in j
