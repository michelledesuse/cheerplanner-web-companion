"""Iter80 backend tests:
1) Music stream HTTP Range support (200 full + 206 partial with Content-Range).
2) Roster 'request-info' share link (roster_member kind) — reuse, data prefill,
   submit updates THAT member, and SMS guard on no-phone.
"""
import base64
import os
import uuid

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break
assert BASE, "EXPO_PUBLIC_BACKEND_URL not set"

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    s.token = tok
    return s


# ------------------------------------------------------------------
# 1) Music HTTP Range support
# ------------------------------------------------------------------
class TestMusicRangeStream:
    @pytest.fixture(scope="class")
    def track(self, sess):
        # Small unique payload (2048 bytes) so we can verify byte-exact slices
        payload = os.urandom(2048)
        b64 = base64.b64encode(payload).decode()

        r = sess.post(
            f"{BASE}/api/team/music/init",
            json={"title": f"TEST_ITER80 Range {uuid.uuid4().hex[:6]}",
                  "filename": "range.mp3", "content_type": "audio/mpeg"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        tid = r.json()["track_id"]
        # upload as a single chunk
        rr = sess.post(f"{BASE}/api/team/music/{tid}/chunk",
                       json={"index": 0, "data": b64}, timeout=30)
        assert rr.status_code == 200, rr.text
        # finish
        rf = sess.post(f"{BASE}/api/team/music/{tid}/finish", timeout=30)
        assert rf.status_code == 200, rf.text
        assert rf.json()["size"] == len(payload)
        yield {"id": tid, "bytes": payload, "size": len(payload)}
        # teardown
        try:
            sess.delete(f"{BASE}/api/team/music/{tid}", timeout=30)
        except Exception:
            pass

    def test_full_get_returns_200_with_accept_ranges(self, sess, track):
        r = requests.get(
            f"{BASE}/api/team/music/{track['id']}/stream",
            params={"token": sess.token}, timeout=30,
        )
        assert r.status_code == 200
        assert r.headers.get("Accept-Ranges") == "bytes"
        assert r.content == track["bytes"]

    def test_range_prefix_returns_206_first_100_bytes(self, sess, track):
        r = requests.get(
            f"{BASE}/api/team/music/{track['id']}/stream",
            params={"token": sess.token},
            headers={"Range": "bytes=0-99"},
            timeout=30,
        )
        assert r.status_code == 206, r.text
        assert r.headers.get("Content-Range") == f"bytes 0-99/{track['size']}"
        assert r.headers.get("Accept-Ranges") == "bytes"
        assert int(r.headers.get("Content-Length", "0")) == 100
        assert len(r.content) == 100
        assert r.content == track["bytes"][0:100]

    def test_range_mid_slice_returns_206_correct_bytes(self, sess, track):
        r = requests.get(
            f"{BASE}/api/team/music/{track['id']}/stream",
            params={"token": sess.token},
            headers={"Range": "bytes=100-199"},
            timeout=30,
        )
        assert r.status_code == 206
        assert r.headers.get("Content-Range") == f"bytes 100-199/{track['size']}"
        assert len(r.content) == 100
        assert r.content == track["bytes"][100:200]

    def test_open_ended_range_returns_206(self, sess, track):
        r = requests.get(
            f"{BASE}/api/team/music/{track['id']}/stream",
            params={"token": sess.token},
            headers={"Range": "bytes=2000-"},
            timeout=30,
        )
        assert r.status_code == 206
        total = track["size"]
        assert r.headers.get("Content-Range") == f"bytes 2000-{total - 1}/{total}"
        assert r.content == track["bytes"][2000:]

    def test_bad_token_401(self, sess, track):
        r = requests.get(
            f"{BASE}/api/team/music/{track['id']}/stream",
            params={"token": "not-a-token"}, timeout=30,
        )
        assert r.status_code == 401

    def test_missing_token_rejected(self, track):
        r = requests.get(f"{BASE}/api/team/music/{track['id']}/stream", timeout=30)
        assert r.status_code in (401, 422)


# ------------------------------------------------------------------
# 2) Roster request-info (roster_member share link)
# ------------------------------------------------------------------
class TestRosterRequestInfo:
    BASE_URL_PARAM = "https://event-planner-394.preview.emergentagent.com"

    @pytest.fixture(scope="class")
    def member_no_phone(self, sess):
        r = sess.post(f"{BASE}/api/roster", json={
            "name": f"TEST_ITER80 NoPhone {uuid.uuid4().hex[:6]}",
            "first_name": "TEST", "last_name": "NoPhone",
            "role": "athlete",
        }, timeout=30)
        assert r.status_code == 200, r.text
        m = r.json()
        yield m
        try:
            sess.delete(f"{BASE}/api/roster/{m['id']}", timeout=30)
        except Exception:
            pass

    @pytest.fixture(scope="class")
    def member_with_phone(self, sess):
        # NOTE: intentionally uses an obviously non-real number so this can never
        # be sent to a real phone even if a bug bypasses the send:false guard.
        r = sess.post(f"{BASE}/api/roster", json={
            "name": f"TEST_ITER80 Phone {uuid.uuid4().hex[:6]}",
            "first_name": "TEST", "last_name": "Phone",
            "role": "athlete",
            "phone": "+15005550006",  # Twilio test/magic number, never delivers
        }, timeout=30)
        assert r.status_code == 200, r.text
        m = r.json()
        yield m
        try:
            sess.delete(f"{BASE}/api/roster/{m['id']}", timeout=30)
        except Exception:
            pass

    def test_request_info_returns_link_and_reuses_token(self, sess, member_with_phone):
        m = member_with_phone
        body = {"base_url": self.BASE_URL_PARAM, "send": False}
        r1 = sess.post(f"{BASE}/api/team/roster/{m['id']}/request-info", json=body, timeout=30)
        assert r1.status_code == 200, r1.text
        j1 = r1.json()
        assert "token" in j1 and j1["token"]
        assert j1["url"].endswith(f"/api/public/s/{j1['token']}")
        assert j1["has_phone"] is True
        assert j1["sent"] is False

        # call again — should return SAME token (reuse)
        r2 = sess.post(f"{BASE}/api/team/roster/{m['id']}/request-info", json=body, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["token"] == j1["token"], "token must be reused"

    def test_public_data_returns_roster_member_with_prefilled_member(self, sess, member_with_phone):
        m = member_with_phone
        body = {"base_url": self.BASE_URL_PARAM, "send": False}
        j = sess.post(f"{BASE}/api/team/roster/{m['id']}/request-info", json=body, timeout=30).json()
        token = j["token"]
        r = requests.get(f"{BASE}/api/public/share/{token}/data", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["kind"] == "roster_member"
        assert "member" in d and isinstance(d["member"], dict)
        assert d["member"]["id"] == m["id"]
        assert d["member"]["first_name"] == "TEST"
        assert d["member"]["last_name"] == "Phone"
        assert d["member"]["phone"] == "+15005550006"

    def test_public_submit_updates_that_specific_member(self, sess, member_with_phone):
        m = member_with_phone
        body = {"base_url": self.BASE_URL_PARAM, "send": False}
        token = sess.post(f"{BASE}/api/team/roster/{m['id']}/request-info", json=body, timeout=30).json()["token"]

        # submit with new info
        new_email = f"iter80+{uuid.uuid4().hex[:6]}@example.com"
        sub = requests.post(
            f"{BASE}/api/public/share/{token}/submit",
            json={
                "first_name": "TEST",
                "last_name": "Phone",
                "preferred_name": "Bee",
                "role": "athlete",
                "email": new_email,
                "food_allergies": "Peanuts",
            },
            timeout=30,
        )
        assert sub.status_code == 200, sub.text
        assert sub.json().get("ok") is True

        # verify roster row updated (that member specifically)
        listed = sess.get(f"{BASE}/api/roster", timeout=30).json()
        me = next((x for x in listed if x["id"] == m["id"]), None)
        assert me is not None, "member should still exist"
        assert me.get("preferred_name") == "Bee"
        assert me.get("email") == new_email
        assert me.get("food_allergies") == "Peanuts"
        assert me.get("pending_review") is True  # flagged for coach review

    def test_send_true_with_no_phone_returns_400(self, sess, member_no_phone):
        m = member_no_phone
        body = {"base_url": self.BASE_URL_PARAM, "send": True}
        r = sess.post(f"{BASE}/api/team/roster/{m['id']}/request-info", json=body, timeout=30)
        # Either "no phone" 400 OR "SMS not configured" 400 — both acceptable
        # guards. Must NOT be 200 (we never want a real SMS attempted).
        assert r.status_code == 400, f"expected 400 guard, got {r.status_code}: {r.text}"

    def test_bad_base_url_rejected(self, sess, member_with_phone):
        m = member_with_phone
        r = sess.post(f"{BASE}/api/team/roster/{m['id']}/request-info",
                      json={"base_url": "http://insecure.example.com", "send": False}, timeout=30)
        assert r.status_code == 400

    def test_nonexistent_member_returns_404(self, sess):
        r = sess.post(f"{BASE}/api/team/roster/does-not-exist/request-info",
                      json={"base_url": self.BASE_URL_PARAM, "send": False}, timeout=30)
        assert r.status_code == 404
