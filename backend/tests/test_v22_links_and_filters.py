"""Backend regression tests for v2.2 batch:
- Links[] persistence on schedule events (POST/PATCH/GET)
- Links[] persistence on competitions (POST/PATCH/GET)
- /api/calendar returns links[] on schedule items
- Expenses are returned sorted ascending by incurred_on
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback that the codebase uses — the internal env key
    BASE_URL = "https://dynamic-repaint-v108.preview.emergentagent.com"

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"No token in login response: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def created_ids():
    return {"schedule": [], "competition": []}


# ---- Schedule events with links ----------------------------------------

class TestScheduleLinks:
    def test_create_schedule_with_links_persists(self, client, created_ids):
        title = f"TEST_sched_links_{uuid.uuid4().hex[:6]}"
        payload = {
            "title": title,
            "event_type": "practice",
            "date": "2027-05-10",
            "links": [
                {"label": "Livestream", "url": "https://example.com/live"},
                {"label": "Tickets", "url": "https://example.com/tix"},
            ],
        }
        r = client.post(f"{BASE_URL}/api/schedule", json=payload, timeout=10)
        assert r.status_code in (200, 201), r.text
        resp = r.json()
        # POST /api/schedule returns List[ScheduleEvent] (recurrence-aware)
        data = resp[0] if isinstance(resp, list) else resp
        assert data.get("title") == title
        assert isinstance(data.get("links"), list) and len(data["links"]) == 2
        assert data["links"][0]["label"] == "Livestream"
        assert data["links"][0]["url"] == "https://example.com/live"
        created_ids["schedule"].append(data["id"])

        # GET verification
        g = client.get(f"{BASE_URL}/api/schedule", timeout=10)
        assert g.status_code == 200
        items = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
        match = next((x for x in items if x["id"] == data["id"]), None)
        assert match, "created schedule event not found on GET /schedule"
        assert len(match.get("links", [])) == 2

    def test_patch_schedule_updates_links(self, client, created_ids):
        assert created_ids["schedule"], "no schedule id from previous test"
        sid = created_ids["schedule"][0]
        new_links = [{"label": "Roster", "url": "https://example.com/roster"}]
        r = client.patch(f"{BASE_URL}/api/schedule/{sid}", json={"links": new_links}, timeout=10)
        assert r.status_code in (200, 204), r.text
        # Verify persisted
        g = client.get(f"{BASE_URL}/api/schedule", timeout=10)
        items = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
        match = next((x for x in items if x["id"] == sid), None)
        assert match and len(match.get("links", [])) == 1
        assert match["links"][0]["label"] == "Roster"

    def test_calendar_includes_links_on_schedule_items(self, client, created_ids):
        assert created_ids["schedule"], "no schedule id"
        r = client.get(f"{BASE_URL}/api/calendar?start=2027-05-01&end=2027-05-31", timeout=10)
        assert r.status_code == 200
        items = r.json()["items"]
        sched_items = [i for i in items if i["kind"] == "schedule" and i["id"].startswith("schedule-")]
        # Find the one for our sid
        target = next((i for i in sched_items if created_ids["schedule"][0] in i["id"]), None)
        assert target is not None, f"schedule event not found in calendar; got {len(sched_items)} schedule items"
        assert isinstance(target.get("links"), list)
        assert len(target["links"]) == 1
        assert target["links"][0]["label"] == "Roster"


# ---- Competitions with links -------------------------------------------

class TestCompetitionLinks:
    def test_create_competition_with_links(self, client, created_ids):
        name = f"TEST_comp_links_{uuid.uuid4().hex[:6]}"
        payload = {
            "name": name,
            "event_date": "2027-06-15",
            "location": "Test Arena",
            "links": [
                {"label": "Event page", "url": "https://example.com/comp"},
            ],
        }
        r = client.post(f"{BASE_URL}/api/competitions", json=payload, timeout=10)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data["name"] == name
        assert isinstance(data.get("links"), list) and len(data["links"]) == 1
        assert data["links"][0]["url"] == "https://example.com/comp"
        created_ids["competition"].append(data["id"])

        # GET all comps & verify
        g = client.get(f"{BASE_URL}/api/competitions", timeout=10)
        assert g.status_code == 200
        items = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
        match = next((x for x in items if x["id"] == data["id"]), None)
        assert match and len(match.get("links", [])) == 1

    def test_patch_competition_replaces_links(self, client, created_ids):
        assert created_ids["competition"], "no comp id"
        cid = created_ids["competition"][0]
        new_links = [
            {"label": "Livestream", "url": "https://example.com/live2"},
            {"label": "Bracket", "url": "https://example.com/bracket"},
        ]
        r = client.patch(f"{BASE_URL}/api/competitions/{cid}", json={"links": new_links}, timeout=10)
        assert r.status_code in (200, 204), r.text

        g = client.get(f"{BASE_URL}/api/competitions/{cid}", timeout=10)
        assert g.status_code == 200
        c = g.json()
        assert len(c.get("links", [])) == 2
        labels = [ln["label"] for ln in c["links"]]
        assert "Livestream" in labels and "Bracket" in labels


# ---- Expenses sort ascending -------------------------------------------

class TestExpensesSort:
    def test_expenses_sorted_ascending_by_incurred_on(self, client):
        r = client.get(f"{BASE_URL}/api/expenses", timeout=10)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if len(items) < 2:
            pytest.skip("not enough expenses to check sort")
        dates = [x.get("incurred_on") or "" for x in items]
        # Filter out empty
        dates_nonempty = [d for d in dates if d]
        assert dates_nonempty == sorted(dates_nonempty), f"expenses not ascending by incurred_on: {dates_nonempty[:5]}..."


# ---- Cleanup ---------------------------------------------------------

def test_cleanup(client, created_ids):
    for sid in created_ids["schedule"]:
        client.delete(f"{BASE_URL}/api/schedule/{sid}", timeout=10)
    for cid in created_ids["competition"]:
        client.delete(f"{BASE_URL}/api/competitions/{cid}", timeout=10)
