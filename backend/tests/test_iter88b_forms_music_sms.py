"""Regression tests for CheerPlanner 2.0 features:
  A) Team Forms links + photos (POST/PATCH/GET + public share)
  B) Calendar has_music flag for competitions & events
  C) Competition & Schedule event_reminder_offsets persistence
"""
import os
import time
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
EMAIL = "demo@cheerplanner.app"
PASSWORD = "CheerDemo2026!"


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


HDR = None


def setup_module(_):
    global HDR
    HDR = _login()


# ---------------- A) Team Forms links + photos ----------------
def test_A_team_forms_links_and_photos():
    # Create form with links
    payload = {
        "name": "TEST_LinksPhotos",
        "description": "regression",
        "questions": [{"label": "size?", "type": "text", "required": False, "order": 0}],
        "links": [{"label": "Menu", "url": "https://example.com/menu"}],
    }
    r = requests.post(f"{BASE_URL}/api/team/forms", json=payload, headers=HDR, timeout=20)
    assert r.status_code == 200, r.text
    form = r.json()
    fid = form["id"]
    assert any(l.get("url") == "https://example.com/menu" for l in form.get("links") or [])

    try:
        # PATCH with photos base64 + additional link
        photo_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        r2 = requests.patch(
            f"{BASE_URL}/api/team/forms/{fid}",
            json={"photos": [photo_b64], "links": [
                {"label": "Menu", "url": "https://example.com/menu"},
                {"label": "Rules", "url": "https://example.com/rules"},
            ]},
            headers=HDR, timeout=20,
        )
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert photo_b64 in (d.get("photos") or [])
        assert len(d.get("links") or []) == 2

        # GET form
        r3 = requests.get(f"{BASE_URL}/api/team/forms/{fid}", headers=HDR, timeout=20)
        assert r3.status_code == 200
        got = r3.json()
        assert photo_b64 in (got.get("photos") or [])
        assert len(got.get("links") or []) == 2

        # Create a public share link for this form
        r4 = requests.post(f"{BASE_URL}/api/team/share", json={"kind": "form", "ref_id": fid}, headers=HDR, timeout=20)
        assert r4.status_code == 200, r4.text
        token = r4.json()["token"]

        # Public data returns photos & links
        r5 = requests.get(f"{BASE_URL}/api/public/share/{token}/data", timeout=20)
        assert r5.status_code == 200, r5.text
        pub = r5.json()
        assert pub.get("kind") == "form"
        assert photo_b64 in (pub.get("photos") or [])
        assert any(l.get("url") == "https://example.com/rules" for l in (pub.get("links") or []))
    finally:
        requests.delete(f"{BASE_URL}/api/team/forms/{fid}", headers=HDR, timeout=20)


# ---------------- B) Calendar has_music ----------------
def test_B_calendar_has_music_flag():
    # Create competition
    ev_date = "2027-05-15"
    r = requests.post(f"{BASE_URL}/api/competitions", json={"name": "TEST_MusicComp", "event_date": ev_date}, headers=HDR, timeout=20)
    assert r.status_code == 200, r.text
    comp = r.json()
    cid = comp["id"]

    # Create schedule event
    r2 = requests.post(f"{BASE_URL}/api/schedule", json={"title": "TEST_MusicPractice", "date": ev_date, "event_type": "practice"}, headers=HDR, timeout=20)
    assert r2.status_code == 200, r2.text
    body = r2.json()
    ev = body[0] if isinstance(body, list) else body
    eid = ev["id"]

    try:
        # Baseline: no music yet
        rc = requests.get(f"{BASE_URL}/api/calendar?start=2027-05-01&end=2027-05-31", headers=HDR, timeout=20)
        assert rc.status_code == 200
        items = rc.json().get("items", [])
        comp_item = next((i for i in items if i["id"].startswith(f"comp-{cid}")), None)
        sch_item = next((i for i in items if i["id"] == f"schedule-{eid}"), None)
        assert comp_item is not None and comp_item.get("has_music") is False
        assert sch_item is not None and sch_item.get("has_music") is False

        # Create a ready team_music track attached to both via init + chunk + finish
        import base64 as _b64
        tiny_mp3 = _b64.b64encode(b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\x00" * 200).decode()
        r3 = requests.post(
            f"{BASE_URL}/api/team/music/init",
            json={"title": "TEST_Track", "competition_ids": [cid], "event_ids": [eid], "content_type": "audio/mpeg"},
            headers=HDR, timeout=20,
        )
        assert r3.status_code == 200, r3.text
        tid = r3.json()["track_id"]
        r_chunk = requests.post(
            f"{BASE_URL}/api/team/music/{tid}/chunk",
            json={"index": 0, "data": tiny_mp3}, headers=HDR, timeout=30,
        )
        assert r_chunk.status_code == 200, r_chunk.text
        r_fin = requests.post(f"{BASE_URL}/api/team/music/{tid}/finish", headers=HDR, timeout=30)
        assert r_fin.status_code == 200, r_fin.text
        assert r_fin.json().get("status") == "ready"

        time.sleep(1)
        rc2 = requests.get(f"{BASE_URL}/api/calendar?start=2027-05-01&end=2027-05-31", headers=HDR, timeout=20)
        items2 = rc2.json().get("items", [])
        comp2 = next((i for i in items2 if i["id"].startswith(f"comp-{cid}")), None)
        sch2 = next((i for i in items2 if i["id"] == f"schedule-{eid}"), None)
        assert comp2 and comp2.get("has_music") is True, "competition has_music should flip when track ready"
        assert sch2 and sch2.get("has_music") is True, "schedule has_music should flip when track ready"

        # Cleanup track
        requests.delete(f"{BASE_URL}/api/team/music/{tid}", headers=HDR, timeout=20)
    finally:
        requests.delete(f"{BASE_URL}/api/competitions/{cid}", headers=HDR, timeout=20)
        requests.delete(f"{BASE_URL}/api/schedule/{eid}", headers=HDR, timeout=20)


# ---------------- C) event_reminder_offsets persistence ----------------
def test_C_competition_event_reminder_offsets_persist():
    r = requests.post(
        f"{BASE_URL}/api/competitions",
        json={"name": "TEST_SMSComp", "event_date": "2027-06-15", "event_time": "10:00", "event_reminder_offsets": [60, 15]},
        headers=HDR, timeout=20,
    )
    assert r.status_code == 200
    cid = r.json()["id"]
    try:
        rg = requests.get(f"{BASE_URL}/api/competitions/{cid}", headers=HDR, timeout=20)
        assert rg.status_code == 200
        assert sorted(rg.json().get("event_reminder_offsets") or []) == [15, 60]

        rp = requests.patch(f"{BASE_URL}/api/competitions/{cid}", json={"event_reminder_offsets": [30, 1]}, headers=HDR, timeout=20)
        assert rp.status_code == 200
        rg2 = requests.get(f"{BASE_URL}/api/competitions/{cid}", headers=HDR, timeout=20)
        assert sorted(rg2.json().get("event_reminder_offsets") or []) == [1, 30]
    finally:
        requests.delete(f"{BASE_URL}/api/competitions/{cid}", headers=HDR, timeout=20)


def test_C_schedule_event_reminder_offsets_persist():
    r = requests.post(
        f"{BASE_URL}/api/schedule",
        json={"title": "TEST_SMSEvent", "date": "2027-06-16", "start_time": "18:00", "event_type": "practice", "event_reminder_offsets": [60, 30, 15, 1]},
        headers=HDR, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # POST /api/schedule may return a list (recurrence) or single item
    ev = body[0] if isinstance(body, list) else body
    eid = ev["id"]
    def _get_schedule(eid_):
        rr = requests.get(f"{BASE_URL}/api/schedule", headers=HDR, timeout=20)
        assert rr.status_code == 200
        for it in rr.json():
            if it.get("id") == eid_:
                return it
        return None
    try:
        got = _get_schedule(eid)
        assert got is not None
        assert sorted(got.get("event_reminder_offsets") or []) == [1, 15, 30, 60]

        rp = requests.patch(f"{BASE_URL}/api/schedule/{eid}", json={"event_reminder_offsets": [15]}, headers=HDR, timeout=20)
        assert rp.status_code == 200
        got2 = _get_schedule(eid)
        assert got2.get("event_reminder_offsets") == [15]
    finally:
        requests.delete(f"{BASE_URL}/api/schedule/{eid}", headers=HDR, timeout=20)
