"""Iteration 69 — reproduces the concurrent PUT race condition on
/api/team/sizes/value that causes roster-new.tsx's Promise.all sizes save
to silently drop values. Also asserts public roster HTML render + submit
with sizes works.
"""
import os
import uuid
import time
import concurrent.futures
import requests
import pytest

BASE_URL = os.environ["EXPO_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_BACKEND_URL") else "https://event-planner-394.preview.emergentagent.com"
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def size_columns(auth):
    r = requests.get(f"{BASE_URL}/api/team/sizes", headers=auth)
    assert r.status_code == 200
    cols = sorted(r.json().get("columns") or [], key=lambda c: c.get("order", 0))
    assert len(cols) >= 4, "need enough columns to reproduce race"
    return cols


@pytest.fixture(scope="module")
def test_member(auth):
    payload = {"first_name": f"TESTRace{int(time.time())}", "last_name": "Sizes", "role": "athlete"}
    r = requests.post(f"{BASE_URL}/api/roster", headers=auth, json=payload)
    assert r.status_code in (200, 201)
    mid = r.json()["id"]
    yield mid
    requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=auth)


class TestSizesRaceCondition:
    """Fires N concurrent PUT /api/team/sizes/value calls (mirrors what
    roster-new.tsx does via Promise.all when saving a person) and asserts
    ALL values persist. Currently FAILS due to non-atomic read-modify-write
    inside sizes.set_size_value."""

    def test_concurrent_puts_persist_all_values(self, auth, size_columns, test_member):
        url = f"{BASE_URL}/api/team/sizes/value"
        cols = size_columns
        vals = [f"V{i+1}" for i in range(len(cols))]

        # Reset first
        for c in cols:
            requests.put(url, headers=auth, json={"member_id": test_member, "column_id": c["id"], "value": ""})

        def do(i):
            return requests.put(url, headers=auth, json={"member_id": test_member, "column_id": cols[i]["id"], "value": vals[i]}).status_code

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(cols)) as ex:
            statuses = list(ex.map(do, range(len(cols))))
        assert all(s == 200 for s in statuses), statuses

        # GET back and verify EVERY value stuck
        r = requests.get(f"{BASE_URL}/api/team/sizes", headers=auth)
        got = (r.json().get("values") or {}).get(test_member, {})
        expected = {c["id"]: v for c, v in zip(cols, vals)}
        missing = {cid: expected[cid] for cid in expected if got.get(cid) != expected[cid]}
        assert not missing, (
            f"Race condition confirmed: {len(missing)}/{len(expected)} size values dropped by "
            f"concurrent PUT /api/team/sizes/value. Missing: {missing}"
        )


class TestPublicRosterShareWithSizes:
    def test_public_page_and_submit_saves_sizes(self, auth):
        # Create roster share link
        r = requests.post(f"{BASE_URL}/api/team/share", headers=auth, json={"kind": "roster"})
        assert r.status_code == 200
        token = r.json()["token"]

        # HTML page renders
        h = requests.get(f"{BASE_URL}/api/public/s/{token}")
        assert h.status_code == 200
        assert "Sizes" in h.text and "sz_" in h.text, "Sizes section not in HTML"

        # data endpoint returns size_columns
        d = requests.get(f"{BASE_URL}/api/public/share/{token}/data").json()
        assert d["kind"] == "roster"
        assert len(d.get("size_columns") or []) >= 4

        # Submit with sizes
        uniq = uuid.uuid4().hex[:8]
        cols = d["size_columns"]
        sizes = {c["id"]: f"S{i}" for i, c in enumerate(cols)}
        sub = requests.post(
            f"{BASE_URL}/api/public/share/{token}/submit",
            json={"first_name": f"TESTPub{uniq}", "last_name": "Sub", "role": "athlete", "sizes": sizes},
        )
        assert sub.status_code == 200 and sub.json().get("ok")

        # Look up the created member + verify sizes stuck
        rm_list = requests.get(f"{BASE_URL}/api/roster", headers=auth).json()
        mid = next((m["id"] for m in rm_list if m.get("name", "").startswith(f"TESTPub{uniq}")), None)
        assert mid, "public submit did not create the roster member"
        vals = (requests.get(f"{BASE_URL}/api/team/sizes", headers=auth).json().get("values") or {}).get(mid, {})
        assert vals, "sizes not persisted from public submit"
        # cleanup
        requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=auth)


class TestAttendancePatch:
    def test_patch_title_updates(self, auth):
        c = requests.post(f"{BASE_URL}/api/team/attendance", headers=auth,
                          json={"title": f"TESTAP{int(time.time())}"})
        assert c.status_code == 200
        sid = c.json()["id"]
        try:
            new_title = f"TESTAP_edited_{int(time.time())}"
            p = requests.patch(f"{BASE_URL}/api/team/attendance/{sid}", headers=auth,
                               json={"title": new_title, "date": "2026-02-10"})
            assert p.status_code == 200
            body = p.json()
            assert body["title"] == new_title
            assert body["date"] == "2026-02-10"
            assert body.get("records") == {}
        finally:
            requests.delete(f"{BASE_URL}/api/team/attendance/{sid}", headers=auth)
