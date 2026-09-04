"""
Iteration 118 — Team Hub Calendar improvements
Tests:
1) GET /api/team/calendar/importable returns `already` and `series_id`
2) GET /api/team/calendar/events?from_&to expands within window with occ_date + event_type
3) Import (bulk) marks items as `already` on subsequent /importable calls
"""
import os
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "demo@cheerplanner.app"
PASSWORD = "CheerDemo2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- importable ----------------
class TestImportable:
    def test_importable_shape(self, hdr):
        r = requests.get(f"{BASE_URL}/api/team/calendar/importable", headers=hdr, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "competitions" in j and isinstance(j["competitions"], list)
        assert "events" in j and isinstance(j["events"], list)
        # every competition has `already` bool
        for c in j["competitions"]:
            assert "already" in c and isinstance(c["already"], bool), f"comp missing already: {c}"
            assert "id" in c and "name" in c
        # every event has `already` and `series_id` key
        for e in j["events"]:
            assert "already" in e and isinstance(e["already"], bool), f"ev missing already: {e}"
            assert "series_id" in e, f"ev missing series_id key: {e}"
            assert "id" in e and "title" in e and "date" in e


# ---------------- events?from_&to ----------------
class TestEventsRange:
    def test_events_returns_role_and_events(self, hdr):
        today = date.today()
        frm = today.isoformat()
        to = (today + timedelta(days=60)).isoformat()
        r = requests.get(f"{BASE_URL}/api/team/calendar/events?from_={frm}&to={to}", headers=hdr, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("role") in ("staff", "viewer"), j
        assert isinstance(j.get("events"), list)
        # Each expanded event has occ_date within window and event_type
        for ev in j["events"]:
            assert "occ_date" in ev and "event_type" in ev and "event_id" in ev and "title" in ev
            assert frm <= ev["occ_date"] <= to, f"occ_date {ev['occ_date']} outside {frm}..{to}"

    def test_events_narrow_window(self, hdr):
        # 7-day window; expansion should keep occ_date inside
        today = date.today()
        frm = today.isoformat()
        to = (today + timedelta(days=7)).isoformat()
        r = requests.get(f"{BASE_URL}/api/team/calendar/events?from_={frm}&to={to}", headers=hdr, timeout=30)
        assert r.status_code == 200
        for ev in r.json().get("events", []):
            assert frm <= ev["occ_date"] <= to


# ---------------- Bulk import + already-flag round-trip ----------------
class TestBulkImportMarksAlready:
    """
    Reproduces the user-facing flow:
      1. GET /importable
      2. Pick 1-2 items not-yet-already
      3. POST /import-from-personal-bulk
      4. GET /importable again -> those ids come back with already=true
      5. Cleanup: DELETE the newly-created team_events
    """

    def test_bulk_import_and_reflect_added(self, hdr):
        # Step 1
        r = requests.get(f"{BASE_URL}/api/team/calendar/importable", headers=hdr, timeout=30)
        assert r.status_code == 200
        imp = r.json()

        # Collect up to 2 non-already candidates (prefer 1 comp + 1 event)
        candidates = []
        for c in imp["competitions"]:
            if not c["already"]:
                candidates.append({"id": c["id"], "source": "competition"})
                break
        for e in imp["events"]:
            if not e["already"]:
                candidates.append({"id": e["id"], "source": "schedule"})
                break

        if not candidates:
            pytest.skip("No non-already competitions/events available to import for demo account.")

        picked_ids = {c["id"] for c in candidates}

        # Step 2/3 — bulk import
        body = {"items": candidates, "include": {"travel": True, "teams_to_watch": True, "packing_list": True, "links": True}}
        r2 = requests.post(f"{BASE_URL}/api/team/calendar/import-from-personal-bulk", headers=hdr, json=body, timeout=30)
        assert r2.status_code == 200, r2.text
        res = r2.json()
        assert res.get("ok") is True
        assert res.get("imported", 0) + res.get("already", 0) + res.get("skipped", 0) == len(candidates)

        # Step 4 — reload importable, verify picked ids show already=True
        r3 = requests.get(f"{BASE_URL}/api/team/calendar/importable", headers=hdr, timeout=30)
        assert r3.status_code == 200
        imp2 = r3.json()
        by_id = {}
        for c in imp2["competitions"]:
            by_id[c["id"]] = c["already"]
        for e in imp2["events"]:
            by_id[e["id"]] = e["already"]
        for pid in picked_ids:
            assert by_id.get(pid) is True, f"expected {pid} to be marked already after import; got {by_id.get(pid)}"

        # Step 5 — cleanup: find and delete the team_events created for these sources
        # Look them up via team/calendar/events (large window)
        today = date.today().isoformat()
        far = (date.today() + timedelta(days=730)).isoformat()
        r4 = requests.get(f"{BASE_URL}/api/team/calendar/events?from_={today}&to={far}", headers=hdr, timeout=30)
        seen_event_ids = set()
        if r4.status_code == 200:
            # We can't easily reverse-map imported_from_personal_id from the list endpoint;
            # rely on DELETE by all events sourced from any of our candidates being idempotent.
            # Fallback strategy: hit /importable and delete any team event whose imported_from_personal_id
            # is in picked_ids by scanning team_events via a helper endpoint if present.
            pass

        # Best-effort cleanup path: import a duplicate returns already=true and doesn't dirty state,
        # but to avoid accumulating on the demo account we delete via team_events collection through
        # DELETE /api/team/calendar/events/{event_id}. Without direct DB access here we can't map IDs,
        # so we leave the imports in place — but assert re-import returns already for cleanliness.
        r5 = requests.post(f"{BASE_URL}/api/team/calendar/import-from-personal-bulk", headers=hdr, json=body, timeout=30)
        assert r5.status_code == 200
        res5 = r5.json()
        assert res5.get("already", 0) >= len(candidates), f"expected re-import to show already>= {len(candidates)}: {res5}"

        # NOTE: we skip DB-level cleanup here (no admin endpoint accessible from tests).
        # The imports are idempotent by source-id, so re-running this test is safe.
