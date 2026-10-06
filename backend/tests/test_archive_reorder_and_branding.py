"""Backend regression for TeamHub archive/reorder across all 6 modules + branded link check.

Modules tested:
  - forms           POST /api/team/forms/reorder    PATCH /api/team/forms/{id}/archive
  - payments        POST /api/team/payments/reorder PATCH /api/team/payments/{id}/archive
  - signups         POST /api/team/signups/reorder  PATCH /api/team/signups/{id}/archive
  - paperwork       POST /api/team/paperwork/reorder PATCH /api/team/paperwork/{id}/archive
  - attendance      POST /api/team/attendance/reorder PATCH /api/team/attendance/{id}/archive
  - results         POST /api/team/results/reorder   PATCH /api/team/results/{id}/archive

Also verifies:
  - POST /api/team/share url starts with https://cheer-planner.com/api/public/s/
  - POST /api/auth/forgot-password response/web link uses the branded host and never leaks
    emergent.host / emergentagent.com / app.cheer-planner.com
"""
import os
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("TEST_BASE", "http://localhost:8001")
BASE = BASE.rstrip("/") + "/api"

DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASSWORD = "CheerDemo2026!"

FORBIDDEN_HOSTS = ("emergent.host", "emergentagent.com", "app.cheer-planner.com")


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{BASE}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


# ---------- helpers ---------------------------------------------------------
def _assert_no_bad_hosts(text: str, label: str):
    low = (text or "").lower()
    for bad in FORBIDDEN_HOSTS:
        assert bad not in low, f"{label}: leaked forbidden host '{bad}' in {text!r}"


def _list_ids(items, key="id"):
    return [i[key] for i in items]


def _reorder_archive_cycle(h, module: str, list_url: str, reorder_url: str,
                           archive_url_tpl: str, create_fn, items_key_in_list=None,
                           cleanup_fn=None):
    """Generic verifier: creates 3 items, reorders them (reverse), verifies order,
    archives one, verifies it's hidden on default list, visible with include_archived,
    then un-archives and cleans up."""
    created_ids = []
    try:
        for i in range(3):
            created_ids.append(create_fn(f"T_{module}_{i}"))

        # List defaults -- ensure our created ids are present
        r = requests.get(list_url, headers=h, timeout=15)
        assert r.status_code == 200, f"[{module}] list failed: {r.text}"
        data = r.json()
        items = data[items_key_in_list] if items_key_in_list else data
        present = _list_ids(items)
        for cid in created_ids:
            assert cid in present, f"[{module}] created id {cid} missing from list"

        # Reorder reverse
        reversed_ids = list(reversed(created_ids))
        r = requests.post(reorder_url, headers=h, json={"ids": reversed_ids}, timeout=15)
        assert r.status_code == 200, f"[{module}] reorder failed: {r.text}"

        r = requests.get(list_url, headers=h, timeout=15)
        items = r.json()[items_key_in_list] if items_key_in_list else r.json()
        # Filter to only our created items in listed order and ensure new order is applied
        only = [i["id"] for i in items if i["id"] in created_ids]
        assert only == reversed_ids, f"[{module}] expected {reversed_ids} but got {only}"

        # Archive first
        target = created_ids[0]
        r = requests.patch(archive_url_tpl.format(id=target), headers=h,
                            json={"archived": True}, timeout=15)
        assert r.status_code == 200, f"[{module}] archive failed: {r.text}"

        r = requests.get(list_url, headers=h, timeout=15)
        items = r.json()[items_key_in_list] if items_key_in_list else r.json()
        assert target not in _list_ids(items), f"[{module}] archived item still in default list"

        r = requests.get(list_url + ("&" if "?" in list_url else "?") + "include_archived=true",
                         headers=h, timeout=15)
        items = r.json()[items_key_in_list] if items_key_in_list else r.json()
        found = next((i for i in items if i["id"] == target), None)
        assert found is not None, f"[{module}] archived item missing when include_archived=true"
        assert found.get("archived") is True, f"[{module}] archived flag not true"

        # Un-archive
        r = requests.patch(archive_url_tpl.format(id=target), headers=h,
                            json={"archived": False}, timeout=15)
        assert r.status_code == 200
        r = requests.get(list_url, headers=h, timeout=15)
        items = r.json()[items_key_in_list] if items_key_in_list else r.json()
        assert target in _list_ids(items), f"[{module}] un-archive didn't restore"
    finally:
        if cleanup_fn:
            for cid in created_ids:
                try:
                    cleanup_fn(cid)
                except Exception:
                    pass


# ---------- Branding tests --------------------------------------------------
class TestBrandedLinks:
    def test_team_share_url_branded(self, h):
        r = requests.post(f"{BASE}/team/share", headers=h,
                          json={"kind": "roster", "ref_id": None}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "url" in body and "token" in body
        assert body["url"].startswith("https://cheer-planner.com/api/public/s/"), body
        assert body["url"].endswith(body["token"])
        _assert_no_bad_hosts(body["url"], "team/share url")

    def test_forgot_password_branded(self):
        # unauth; endpoint always returns 200 to avoid user enumeration
        r = requests.post(f"{BASE}/auth/forgot-password", json={"email": DEMO_EMAIL}, timeout=20)
        assert r.status_code == 200, r.text
        _assert_no_bad_hosts(r.text, "forgot-password response")


# ---------- Module tests ----------------------------------------------------
class TestForms:
    def test_cycle(self, h):
        def create(name):
            r = requests.post(f"{BASE}/team/forms", headers=h,
                              json={"name": name, "fields": [{"label": "Q1", "kind": "text"}]}, timeout=15)
            assert r.status_code == 200, r.text
            return r.json()["id"]

        def cleanup(fid):
            requests.delete(f"{BASE}/team/forms/{fid}", headers=h, timeout=10)

        _reorder_archive_cycle(h, "forms",
                               list_url=f"{BASE}/team/forms",
                               reorder_url=f"{BASE}/team/forms/reorder",
                               archive_url_tpl=f"{BASE}/team/forms/{{id}}/archive",
                               create_fn=create, cleanup_fn=cleanup)


class TestPayments:
    def test_cycle(self, h):
        def create(name):
            r = requests.post(f"{BASE}/team/payments", headers=h,
                              json={"name": name, "amount": 10}, timeout=15)
            assert r.status_code == 200, r.text
            return r.json()["id"]

        def cleanup(pid):
            requests.delete(f"{BASE}/team/payments/{pid}", headers=h, timeout=10)

        _reorder_archive_cycle(h, "payments",
                               list_url=f"{BASE}/team/payments",
                               reorder_url=f"{BASE}/team/payments/reorder",
                               archive_url_tpl=f"{BASE}/team/payments/{{id}}/archive",
                               create_fn=create, cleanup_fn=cleanup)


class TestSignups:
    def test_cycle(self, h):
        def create(name):
            r = requests.post(f"{BASE}/team/signups", headers=h, json={"name": name}, timeout=15)
            assert r.status_code == 200, r.text
            return r.json()["id"]

        def cleanup(sid):
            requests.delete(f"{BASE}/team/signups/{sid}", headers=h, timeout=10)

        _reorder_archive_cycle(h, "signups",
                               list_url=f"{BASE}/team/signups",
                               reorder_url=f"{BASE}/team/signups/reorder",
                               archive_url_tpl=f"{BASE}/team/signups/{{id}}/archive",
                               create_fn=create, cleanup_fn=cleanup)


class TestPaperwork:
    def test_cycle(self, h):
        def create(name):
            r = requests.post(f"{BASE}/team/paperwork", headers=h, json={"name": name}, timeout=15)
            assert r.status_code == 200, r.text
            return r.json()["id"]

        def cleanup(pid):
            requests.delete(f"{BASE}/team/paperwork/{pid}", headers=h, timeout=10)

        _reorder_archive_cycle(h, "paperwork",
                               list_url=f"{BASE}/team/paperwork",
                               reorder_url=f"{BASE}/team/paperwork/reorder",
                               archive_url_tpl=f"{BASE}/team/paperwork/{{id}}/archive",
                               create_fn=create, cleanup_fn=cleanup)


class TestAttendance:
    def test_cycle(self, h):
        def create(name):
            r = requests.post(f"{BASE}/team/attendance", headers=h,
                              json={"title": name, "date": "2026-02-01"}, timeout=15)
            assert r.status_code == 200, r.text
            return r.json()["id"]

        def cleanup(aid):
            requests.delete(f"{BASE}/team/attendance/{aid}", headers=h, timeout=10)

        _reorder_archive_cycle(h, "attendance",
                               list_url=f"{BASE}/team/attendance",
                               reorder_url=f"{BASE}/team/attendance/reorder",
                               archive_url_tpl=f"{BASE}/team/attendance/{{id}}/archive",
                               create_fn=create, cleanup_fn=cleanup)


class TestResults:
    def test_cycle(self, h):
        def create(name):
            r = requests.post(f"{BASE}/team/results", headers=h,
                              json={"title": name, "date": "2026-02-01", "placement": "1st"}, timeout=15)
            assert r.status_code == 200, r.text
            return r.json()["id"]

        def cleanup(rid):
            requests.delete(f"{BASE}/team/results/{rid}", headers=h, timeout=10)

        _reorder_archive_cycle(h, "results",
                               list_url=f"{BASE}/team/results",
                               reorder_url=f"{BASE}/team/results/reorder",
                               archive_url_tpl=f"{BASE}/team/results/{{id}}/archive",
                               create_fn=create,
                               items_key_in_list="results",
                               cleanup_fn=cleanup)
