"""Iter78: Team Music (chunked upload/list/stream/patch/delete/limits) + Seasons scoped edits
(athletes/competitions/teams) tested against the external URL.
"""
import base64
import os
import uuid

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL") else None
# fall back to reading frontend/.env
if not BASE:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().strip('"')
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
    s.token = tok  # attached for stream tests
    return s


# =============================================================
# Team Music
# =============================================================
class TestTeamMusic:
    def test_full_upload_flow_and_stream(self, sess):
        # ~64KB pseudo-audio
        payload_bytes = os.urandom(64 * 1024)
        b64 = base64.b64encode(payload_bytes).decode()

        # init
        r = sess.post(f"{BASE}/api/team/music/init", json={
            "title": "TEST_ITER78 Track", "filename": "test.mp3",
            "content_type": "audio/mpeg",
        }, timeout=30)
        assert r.status_code == 200, r.text
        tid = r.json()["track_id"]

        # chunk (2 chunks)
        half = len(b64) // 2
        for idx, part in enumerate([b64[:half], b64[half:]]):
            rr = sess.post(f"{BASE}/api/team/music/{tid}/chunk",
                           json={"index": idx, "data": part}, timeout=30)
            assert rr.status_code == 200, rr.text

        # finish
        r = sess.post(f"{BASE}/api/team/music/{tid}/finish", timeout=60)
        assert r.status_code == 200, r.text
        track = r.json()
        assert track["status"] == "ready"
        assert track["size"] == len(payload_bytes)

        # list contains it
        r = sess.get(f"{BASE}/api/team/music", timeout=30)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert tid in ids

        # stream roundtrip
        r = requests.get(f"{BASE}/api/team/music/{tid}/stream",
                         params={"token": sess.token}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.content == payload_bytes

        # bad token → 401
        r = requests.get(f"{BASE}/api/team/music/{tid}/stream",
                         params={"token": "not-a-real-token"}, timeout=30)
        assert r.status_code == 401

        # missing token → 422 or 401 (FastAPI requires query param)
        r = requests.get(f"{BASE}/api/team/music/{tid}/stream", timeout=30)
        assert r.status_code in (401, 422)

        # patch title + team_ids
        r = sess.patch(f"{BASE}/api/team/music/{tid}",
                       json={"title": "TEST_ITER78 Renamed", "team_ids": []}, timeout=30)
        assert r.status_code == 200
        assert r.json()["title"] == "TEST_ITER78 Renamed"

        # delete
        r = sess.delete(f"{BASE}/api/team/music/{tid}", timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted") is True

        # verify gone
        r = sess.get(f"{BASE}/api/team/music", timeout=30)
        assert tid not in [t["id"] for t in r.json()]

    def test_finish_rejects_over_15mb(self, sess):
        # init
        r = sess.post(f"{BASE}/api/team/music/init",
                      json={"title": "TEST_ITER78 Big", "filename": "big.mp3"}, timeout=30)
        assert r.status_code == 200
        tid = r.json()["track_id"]

        # 16MB payload as base64, uploaded in ~1MB chunks
        big_bytes = os.urandom(16 * 1024 * 1024)
        b64 = base64.b64encode(big_bytes).decode()
        chunk_size = 1_400_000  # base64 chars, divisible by 4
        idx = 0
        for i in range(0, len(b64), chunk_size):
            r = sess.post(f"{BASE}/api/team/music/{tid}/chunk",
                          json={"index": idx, "data": b64[i:i + chunk_size]}, timeout=60)
            assert r.status_code == 200
            idx += 1

        r = sess.post(f"{BASE}/api/team/music/{tid}/finish", timeout=120)
        assert r.status_code == 400
        assert "too large" in r.text.lower() or "15" in r.text.lower()

    def test_chunk_upload_not_found(self, sess):
        r = sess.post(f"{BASE}/api/team/music/nonexistent-id/chunk",
                      json={"index": 0, "data": "AAAA"}, timeout=30)
        assert r.status_code == 404


# =============================================================
# Seasons scoped update — athletes / competitions / teams
# =============================================================
@pytest.fixture(scope="module")
def two_seasons(sess):
    """Create two throwaway seasons, activate the first. Cleaned up on teardown."""
    s1 = sess.post(f"{BASE}/api/seasons", json={
        "name": f"TEST_ITER78 S1 {uuid.uuid4().hex[:6]}",
        "start_date": "2024-08-01", "end_date": "2025-07-31",
        "make_active": True,
    }, timeout=30)
    assert s1.status_code == 200, s1.text
    s1_id = s1.json()["id"]

    s2 = sess.post(f"{BASE}/api/seasons", json={
        "name": f"TEST_ITER78 S2 {uuid.uuid4().hex[:6]}",
        "start_date": "2025-08-01", "end_date": "2026-07-31",
    }, timeout=30)
    assert s2.status_code == 200, s2.text
    s2_id = s2.json()["id"]

    yield s1_id, s2_id

    for sid in (s1_id, s2_id):
        try:
            sess.delete(f"{BASE}/api/seasons/{sid}", timeout=30)
        except Exception:
            pass


class TestSeasonsScopedEdits:
    def _create_athlete(self, sess, season_ids):
        r = sess.post(f"{BASE}/api/athletes", json={
            "name": f"TEST_ITER78 Ath {uuid.uuid4().hex[:6]}",
            "season_ids": season_ids,
        }, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_athlete_scope_this_forks(self, sess, two_seasons):
        s1, s2 = two_seasons
        # sanity: s1 is active
        active = [x for x in sess.get(f"{BASE}/api/seasons", timeout=30).json()
                  if x.get("is_active")]
        assert active and active[0]["id"] == s1

        ath = self._create_athlete(sess, [s1, s2])
        aid = ath["id"]

        # scope="this" while in two seasons → fork
        r = sess.patch(f"{BASE}/api/athletes/{aid}",
                       json={"name": "TEST_ITER78 Ath (forked)", "edit_scope": "this"}, timeout=30)
        assert r.status_code == 200, r.text
        # get all TEST_ITER78 athletes and confirm two exist with different season memberships
        listed = sess.get(f"{BASE}/api/athletes", timeout=30).json()
        variants = [x for x in listed if x.get("name", "").startswith("TEST_ITER78 Ath")]
        assert len(variants) >= 2
        original = next((x for x in variants if x["id"] == aid), None)
        fork = next((x for x in variants if x["id"] != aid and x["name"].endswith("(forked)")), None)
        assert original is not None and fork is not None
        assert s1 not in (original.get("season_ids") or []) and s2 in (original.get("season_ids") or [])
        assert s1 in (fork.get("season_ids") or []) and s2 not in (fork.get("season_ids") or [])

        # cleanup
        sess.delete(f"{BASE}/api/athletes/{aid}", timeout=30)
        sess.delete(f"{BASE}/api/athletes/{fork['id']}", timeout=30)

    def test_athlete_season_ids_no_scope_updates_in_place(self, sess, two_seasons):
        s1, s2 = two_seasons
        ath = self._create_athlete(sess, [s1])
        aid = ath["id"]
        # update membership in place (no edit_scope)
        r = sess.patch(f"{BASE}/api/athletes/{aid}",
                       json={"season_ids": [s1, s2]}, timeout=30)
        assert r.status_code == 200
        # Fetch fresh
        listed = sess.get(f"{BASE}/api/athletes", timeout=30).json()
        me = next(x for x in listed if x["id"] == aid)
        assert set(me.get("season_ids") or []) == {s1, s2}
        sess.delete(f"{BASE}/api/athletes/{aid}", timeout=30)

    def test_competition_scope_this_forks(self, sess, two_seasons):
        s1, s2 = two_seasons
        r = sess.post(f"{BASE}/api/competitions", json={
            "name": f"TEST_ITER78 Comp {uuid.uuid4().hex[:6]}",
            "event_date": "2025-05-15",
        }, timeout=30)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        # attach to two seasons via in-place PATCH
        r = sess.patch(f"{BASE}/api/competitions/{cid}",
                       json={"season_ids": [s1, s2]}, timeout=30)
        assert r.status_code == 200
        # scope this → fork
        r = sess.patch(f"{BASE}/api/competitions/{cid}",
                       json={"name": "TEST_ITER78 Comp (forked)", "edit_scope": "this"}, timeout=30)
        assert r.status_code == 200
        listed = sess.get(f"{BASE}/api/competitions", timeout=30).json()
        original = next((x for x in listed if x["id"] == cid), None)
        fork = next((x for x in listed if x.get("name", "").endswith("(forked)")
                     and x["id"] != cid), None)
        assert original and fork
        assert set(original.get("season_ids") or []) == {s2}
        assert set(fork.get("season_ids") or []) == {s1}
        sess.delete(f"{BASE}/api/competitions/{cid}", timeout=30)
        sess.delete(f"{BASE}/api/competitions/{fork['id']}", timeout=30)

    def test_team_scope_this_forks(self, sess, two_seasons):
        s1, s2 = two_seasons
        r = sess.post(f"{BASE}/api/teams",
                      json={"name": f"TEST_ITER78 Team {uuid.uuid4().hex[:6]}",
                            "season_ids": [s1, s2]}, timeout=30)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        r = sess.patch(f"{BASE}/api/teams/{tid}",
                       json={"name": "TEST_ITER78 Team (forked)", "edit_scope": "this"}, timeout=30)
        assert r.status_code == 200
        listed = sess.get(f"{BASE}/api/teams", timeout=30).json()
        original = next((x for x in listed if x["id"] == tid), None)
        fork = next((x for x in listed if x.get("name", "").endswith("(forked)")
                     and x["id"] != tid), None)
        assert original and fork
        assert set(original.get("season_ids") or []) == {s2}
        assert set(fork.get("season_ids") or []) == {s1}
        sess.delete(f"{BASE}/api/teams/{tid}", timeout=30)
        sess.delete(f"{BASE}/api/teams/{fork['id']}", timeout=30)

    def test_schedule_patch_season_ids(self, sess, two_seasons):
        s1, s2 = two_seasons
        # need an athlete for athlete_ids? no, event doesn't require it
        r = sess.post(f"{BASE}/api/schedule", json={
            "title": f"TEST_ITER78 Evt {uuid.uuid4().hex[:6]}",
            "date": "2025-06-10",
        }, timeout=30)
        assert r.status_code == 200, r.text
        # schedule returns list
        body = r.json()
        eid = body[0]["id"] if isinstance(body, list) else body["id"]
        r = sess.patch(f"{BASE}/api/schedule/{eid}",
                       json={"season_ids": [s1, s2]}, timeout=30)
        assert r.status_code == 200
        # verify
        listed = sess.get(f"{BASE}/api/schedule", timeout=30).json()
        me = next(x for x in listed if x["id"] == eid)
        assert set(me.get("season_ids") or []) == {s1, s2}
        sess.delete(f"{BASE}/api/schedule/{eid}", timeout=30)
