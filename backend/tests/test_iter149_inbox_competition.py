"""iter149 — Smart Inbox competition-day extraction + confirm."""
from __future__ import annotations
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL missing", allow_module_level=True)
REVIEWER = ("applereview@cheerplanner.app", "Review2026!")
ADMIN = ("reviewsadmin@cheerplanner.app", "AdminRev2026!")


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tok():
    return _login(*REVIEWER)


SAMPLE = (
    "Subject: Spirit Nationals – Important Info for Saturday\n"
    "Hi families, our team competes at Spirit Nationals on 2026-11-19 at the Orange County Convention Center.\n"
    "Performance time: 10:45 AM. Please meet at the Hall B entrance at 9:00 AM for warm-ups.\n"
    "Wear full comp uniform with the gold bow; hair in high pony.\n"
    "Spectator admission is $30 per person; parking is $20 per car.\n"
    "Teams to watch: Stingray Allstars Orange at 11:15 AM, Cheer Athletics Cheetahs at 12:00 PM.\n"
    "Awards at 2:30 PM. Bring water, snacks, and your wristband."
)


class TestInboxCompetitionParse:
    def test_parse_returns_competition_draft(self, tok):
        r = requests.post(f"{BASE_URL}/api/inbox/parse",
                          headers=_h(tok), json={"text": SAMPLE, "source": "paste"}, timeout=90)
        assert r.status_code == 200, r.text[:400]
        items = r.json()
        assert isinstance(items, list) and items, items
        comp = next((d for d in items if d.get("kind") == "competition"), None)
        assert comp, [d.get("kind") for d in items]
        d = comp["data"]
        assert "spirit" in (d.get("name") or "").lower(), d
        assert d.get("event_date", "").startswith("2026-11-19"), d.get("event_date")
        assert d.get("performance_time") in ("10:45", "10:45:00"), d.get("performance_time")
        assert d.get("meet_time", "").startswith("09:00") or d.get("meet_time") == "9:00", d.get("meet_time")
        assert d.get("meeting_location"), d
        assert d.get("what_to_wear"), d
        assert float(d.get("spectator_fee") or 0) == 30.0, d.get("spectator_fee")
        assert float(d.get("parking_fee") or 0) == 20.0, d.get("parking_fee")
        teams = d.get("teams_to_watch") or []
        assert any("stingray" in (t.get("name") or "").lower() for t in teams), teams
        # Matched to existing Spirit Nationals comp by name+date
        assert d.get("matched_competition_id"), d
        TestInboxCompetitionParse.draft_id = comp["id"]
        TestInboxCompetitionParse.matched_id = d["matched_competition_id"]
        TestInboxCompetitionParse.parsed = d


class TestInboxCompetitionConfirm:
    def test_confirm_updates_existing_comp(self, tok):
        did = getattr(TestInboxCompetitionParse, "draft_id", None)
        cid = getattr(TestInboxCompetitionParse, "matched_id", None)
        parsed = getattr(TestInboxCompetitionParse, "parsed", None)
        assert did and cid and parsed, "prior test must pass"

        # Snapshot before to verify we don't overwrite location/address.
        r0 = requests.get(f"{BASE_URL}/api/competitions", headers=_h(tok), timeout=15)
        before = next(c for c in r0.json() if c["id"] == cid)

        body = {
            "kind": "competition",
            "competition_id": cid,
            "competition": {
                "performance_time": parsed.get("performance_time"),
                "meet_time": parsed.get("meet_time"),
                "meeting_location": parsed.get("meeting_location"),
                "what_to_wear": parsed.get("what_to_wear"),
                "spectator_fee": parsed.get("spectator_fee"),
                "parking_fee": parsed.get("parking_fee"),
                "day_details": parsed.get("day_details") or "Awards at 2:30 PM",
                "teams_to_watch": parsed.get("teams_to_watch") or [],
            },
        }
        r = requests.post(f"{BASE_URL}/api/inbox/drafts/{did}/confirm",
                          headers=_h(tok), json=body, timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["ok"] and j["created"]["id"] == cid

        after = next(c for c in requests.get(f"{BASE_URL}/api/competitions",
                     headers=_h(tok), timeout=15).json() if c["id"] == cid)
        assert after.get("event_time"), after
        assert after.get("meet_time"), after
        assert after.get("meeting_location"), after
        assert after.get("what_to_wear"), after
        assert float(after.get("spectator_fee") or 0) == 30.0
        assert float(after.get("parking_fee") or 0) == 20.0
        assert after.get("day_details"), after
        # Did NOT overwrite existing location/address.
        if before.get("location"):
            assert after.get("location") == before.get("location")
        if before.get("address"):
            assert after.get("address") == before.get("address")
        # teams merged — includes Stingray Allstars Orange
        names = [t.get("name") for t in (after.get("teams_to_watch") or [])]
        assert any("stingray" in (n or "").lower() for n in names), names

    def test_confirm_new_comp_requires_name_and_date(self, tok):
        # Create a dummy draft to use with no competition_id
        r = requests.post(f"{BASE_URL}/api/inbox/parse", headers=_h(tok),
                          json={"text": "Some competition info with no name.", "source": "paste"}, timeout=60)
        assert r.status_code == 200
        drafts = r.json()
        did = drafts[0]["id"]
        body = {"kind": "competition", "competition_id": None, "competition": {}}
        r2 = requests.post(f"{BASE_URL}/api/inbox/drafts/{did}/confirm",
                           headers=_h(tok), json=body, timeout=20)
        assert r2.status_code == 400, r2.text[:200]
        # Cleanup
        requests.delete(f"{BASE_URL}/api/inbox/drafts/{did}", headers=_h(tok), timeout=10)


class TestCompetitionCRUDNewFields:
    def test_patch_and_create_accept_new_fields(self, tok):
        # Create
        body = {
            "name": "TEST_iter149_newcomp",
            "event_date": "2027-01-01",
            "meet_time": "08:30",
            "meeting_location": "Lobby A",
            "what_to_wear": "Full uniform",
            "day_details": "Warm-up at 8",
            "spectator_fee": 15,
            "parking_fee": 10,
        }
        r = requests.post(f"{BASE_URL}/api/competitions", headers=_h(tok), json=body, timeout=15)
        assert r.status_code in (200, 201), r.text[:300]
        c = r.json()
        for k, v in body.items():
            assert c.get(k) == v or (isinstance(v, (int, float)) and float(c.get(k) or 0) == float(v)), (k, c.get(k), v)

        cid = c["id"]
        r2 = requests.patch(f"{BASE_URL}/api/competitions/{cid}",
                            headers=_h(tok),
                            json={"meet_time": "09:00", "spectator_fee": 20}, timeout=15)
        assert r2.status_code == 200, r2.text[:200]
        u = r2.json()
        assert u.get("meet_time") == "09:00"
        assert float(u.get("spectator_fee") or 0) == 20.0
        # cleanup
        requests.delete(f"{BASE_URL}/api/competitions/{cid}", headers=_h(tok), timeout=10)


def test_cleanup_restore_review_data():
    """Reseed the applereview account to pristine state."""
    tok = _login(*ADMIN)
    r = requests.post(f"{BASE_URL}/api/admin/seed-review-account", headers=_h(tok), timeout=15)
    assert r.status_code == 200, r.text[:200]
    deadline = time.time() + 240
    last = None
    while time.time() < deadline:
        r2 = requests.get(f"{BASE_URL}/api/admin/seed-review-account", headers=_h(tok), timeout=10)
        last = r2.json()
        if last.get("status") in ("done", "error"):
            break
        time.sleep(5)
    assert last and last.get("status") == "done", last
