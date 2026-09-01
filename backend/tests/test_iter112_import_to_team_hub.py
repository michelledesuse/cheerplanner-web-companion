"""Iter 112 – Import personal competitions / schedule events INTO Team Hub.

Covers:
- GET /api/team/calendar/importable
- POST /api/team/calendar/import-from-personal (single)
- POST /api/team/calendar/import-from-personal-bulk (multi + toggles)
- Idempotency via imported_from_personal_id (re-import → 'already')
- Role gating: non-staff (viewer) → 403 on bulk endpoint
"""
import os
import uuid

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

STAFF = {"email": "demo@cheerplanner.app", "password": "CheerDemo2026!"}
COACH = {"email": "coach.casey@cheerplanner.app", "password": "CheerDemo2026!"}
VIEWER = {"email": "sophia.athlete@cheerplanner.app", "password": "CheerDemo2026!"}


def _login(creds):
    r = requests.post(f"{BASE}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def staff_token():
    return _login(STAFF)


@pytest.fixture(scope="module")
def viewer_token():
    return _login(VIEWER)


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------- Importable listing ----------
def test_importable_returns_structure(staff_token):
    r = requests.get(f"{BASE}/api/team/calendar/importable", headers=_h(staff_token), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "competitions" in body and isinstance(body["competitions"], list)
    assert "events" in body and isinstance(body["events"], list)
    # Demo owner seeded 2 comps → expect at least one.
    assert len(body["competitions"]) >= 1, "Demo owner should have competitions."


def test_importable_forbidden_for_non_staff(viewer_token):
    r = requests.get(f"{BASE}/api/team/calendar/importable", headers=_h(viewer_token), timeout=30)
    assert r.status_code == 403, f"expected 403 for viewer, got {r.status_code} {r.text}"


# ---------- Cleanup helper: delete team events created by these tests ----------
def _cleanup(token, event_ids):
    for eid in event_ids:
        try:
            requests.delete(f"{BASE}/api/team/calendar/events/{eid}", headers=_h(token), timeout=15)
        except Exception:
            pass


# ---------- Single import ----------
def test_import_single_and_idempotent(staff_token):
    imp = requests.get(f"{BASE}/api/team/calendar/importable", headers=_h(staff_token), timeout=30).json()
    assert imp["competitions"], "need at least one competition to import"
    comp_id = imp["competitions"][0]["id"]

    payload = {
        "source": "competition", "id": comp_id,
        "include": {"travel": True, "teams_to_watch": True, "packing_list": True, "links": True},
    }
    r1 = requests.post(f"{BASE}/api/team/calendar/import-from-personal", headers=_h(staff_token), json=payload, timeout=30)
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    created_ids = []
    if body1.get("event_id"):
        created_ids.append(body1["event_id"])

    # Second call must be idempotent
    r2 = requests.post(f"{BASE}/api/team/calendar/import-from-personal", headers=_h(staff_token), json=payload, timeout=30)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    # One of the two calls must be already=True; if both, seed already imported previously.
    assert body2.get("already") is True or body1.get("already") is True, f"expected idempotency: {body1} {body2}"

    # Verify event landed in Team Hub calendar
    from datetime import date, timedelta
    frm = (date.today() - timedelta(days=365)).isoformat()
    to_ = (date.today() + timedelta(days=365)).isoformat()
    evs = requests.get(f"{BASE}/api/team/calendar/events?from_={frm}&to={to_}",
                       headers=_h(staff_token), timeout=30).json()
    titles = [e["title"] for e in evs.get("events", [])]
    assert any(imp["competitions"][0]["name"] == t for t in titles), \
        f"imported competition should appear in team calendar. titles={titles[:10]}"

    _cleanup(staff_token, created_ids)


# ---------- Bulk import ----------
def test_import_bulk_multiple_and_counts(staff_token):
    imp = requests.get(f"{BASE}/api/team/calendar/importable", headers=_h(staff_token), timeout=30).json()
    items = [{"source": "competition", "id": c["id"]} for c in imp["competitions"][:2]]
    items += [{"source": "schedule", "id": e["id"]} for e in imp["events"][:2]]
    assert items, "need something to bulk-import"

    payload = {"items": items, "include": {"travel": True, "teams_to_watch": False, "packing_list": True, "links": True}}
    r = requests.post(f"{BASE}/api/team/calendar/import-from-personal-bulk", headers=_h(staff_token), json=payload, timeout=45)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("imported", "already", "skipped"):
        assert k in body, f"missing key {k} in {body}"
    assert body["imported"] + body["already"] + body["skipped"] == len(items)

    # Re-run: everything should be 'already' now.
    r2 = requests.post(f"{BASE}/api/team/calendar/import-from-personal-bulk", headers=_h(staff_token), json=payload, timeout=45)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["already"] == len(items), f"expected all already, got {body2}"
    assert body2["imported"] == 0

    # Cleanup imported events (best effort — find by imported_from_personal_id via listing titles)
    from datetime import date, timedelta
    frm = (date.today() - timedelta(days=365)).isoformat()
    to_ = (date.today() + timedelta(days=365)).isoformat()
    evs = requests.get(f"{BASE}/api/team/calendar/events?from_={frm}&to={to_}",
                       headers=_h(staff_token), timeout=30).json()
    src_titles = {c["name"] for c in imp["competitions"][:2]} | {e["title"] for e in imp["events"][:2]}
    to_del = [e["event_id"] for e in evs.get("events", []) if e["title"] in src_titles]
    _cleanup(staff_token, to_del)


def test_import_bulk_skips_bad_ids(staff_token):
    payload = {
        "items": [{"source": "competition", "id": str(uuid.uuid4())},
                  {"source": "schedule", "id": str(uuid.uuid4())},
                  {"source": "unknown", "id": "x"}],
        "include": {"travel": False, "teams_to_watch": False, "packing_list": False, "links": False},
    }
    r = requests.post(f"{BASE}/api/team/calendar/import-from-personal-bulk", headers=_h(staff_token), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["skipped"] == 3 and body["imported"] == 0 and body["already"] == 0


# ---------- Role gating ----------
def test_bulk_forbidden_for_viewer(viewer_token):
    payload = {"items": [{"source": "competition", "id": "anything"}], "include": {}}
    r = requests.post(f"{BASE}/api/team/calendar/import-from-personal-bulk", headers=_h(viewer_token), json=payload, timeout=30)
    assert r.status_code == 403, f"expected 403 for viewer, got {r.status_code} {r.text}"


def test_single_forbidden_for_viewer(viewer_token):
    r = requests.post(f"{BASE}/api/team/calendar/import-from-personal",
                      headers=_h(viewer_token),
                      json={"source": "competition", "id": "x", "include": {}}, timeout=30)
    assert r.status_code == 403
