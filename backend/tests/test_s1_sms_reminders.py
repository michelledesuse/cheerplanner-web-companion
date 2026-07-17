"""S1 tests: per-event SMS lead-time reminders.

- Backend persistence for competitions + bookings (round-trip via API).
- Helper `parse_local_datetime` unit tests.
- Scheduler `_valid_offsets` + `send_timed_sms_tick` behavior with Twilio
  monkeypatched (NO real SMS sent) and per-offset dedupe verified.
"""
import os
import sys
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests

# Ensure backend package importable for direct core.* imports
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"
TZ_NAME = "America/New_York"


# ============================================================
# Fixtures
# ============================================================
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def me(token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def api(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


# ============================================================
# 1) Persistence round-trip
# ============================================================
class TestPersistence:
    def test_competition_offsets_persist(self, api):
        payload = {
            "name": "TEST_S1 Comp Persist",
            "event_date": "2026-08-15",
            "booking_release_at": "2026-07-08T14:30",
            "sms_reminder_offsets": [60, 30, 15, 1, 999],  # 999 should be stripped or preserved raw
        }
        r = api.post(f"{BASE_URL}/api/competitions", json=payload)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        try:
            # GET round-trip
            g = api.get(f"{BASE_URL}/api/competitions/{cid}")
            assert g.status_code == 200
            body = g.json()
            assert body["booking_release_at"] == "2026-07-08T14:30"
            # Router stores the raw list; scheduler validates on tick.
            assert isinstance(body["sms_reminder_offsets"], list)
            assert set([60, 30, 15, 1]).issubset(set(body["sms_reminder_offsets"]))

            # PATCH → shrink list, verify persisted
            p = api.patch(f"{BASE_URL}/api/competitions/{cid}", json={"sms_reminder_offsets": [30, 1]})
            assert p.status_code == 200
            assert set(p.json()["sms_reminder_offsets"]) == {30, 1}

            g2 = api.get(f"{BASE_URL}/api/competitions/{cid}")
            assert set(g2.json()["sms_reminder_offsets"]) == {30, 1}
        finally:
            api.delete(f"{BASE_URL}/api/competitions/{cid}")

    def test_flight_booking_offsets_persist(self, api):
        # Need a competition to attach to
        c = api.post(f"{BASE_URL}/api/competitions", json={"name": "TEST_S1 Flight Comp", "event_date": "2026-09-01"})
        assert c.status_code == 200
        cid = c.json()["id"]
        try:
            b = api.post(f"{BASE_URL}/api/bookings", json={
                "competition_id": cid, "type": "flight",
                "depart_time": "2026-09-01T09:00",
                "sms_reminder_offsets": [60, 15],
            })
            assert b.status_code == 200, b.text
            bid = b.json()["id"]
            assert set(b.json()["sms_reminder_offsets"]) == {60, 15}

            lst = api.get(f"{BASE_URL}/api/bookings?competition_id={cid}").json()
            bk = next(x for x in lst if x["id"] == bid)
            assert set(bk["sms_reminder_offsets"]) == {60, 15}

            # PATCH to []
            p = api.patch(f"{BASE_URL}/api/bookings/{bid}", json={"sms_reminder_offsets": []})
            assert p.status_code == 200
            assert p.json()["sms_reminder_offsets"] == []
        finally:
            api.delete(f"{BASE_URL}/api/competitions/{cid}")

    def test_hotel_booking_offsets_default_empty(self, api):
        c = api.post(f"{BASE_URL}/api/competitions", json={"name": "TEST_S1 Hotel Comp", "event_date": "2026-09-02"})
        assert c.status_code == 200
        cid = c.json()["id"]
        try:
            b = api.post(f"{BASE_URL}/api/bookings", json={
                "competition_id": cid, "type": "hotel",
                "provider": "TEST_Hyatt", "check_in": "2026-08-31", "check_out": "2026-09-03",
            })
            assert b.status_code == 200, b.text
            assert b.json()["sms_reminder_offsets"] == []

            # Car type similarly
            b2 = api.post(f"{BASE_URL}/api/bookings", json={
                "competition_id": cid, "type": "car",
                "provider": "TEST_Enterprise", "pickup_at": "2026-08-31T15:00",
            })
            assert b2.status_code == 200
            assert b2.json()["sms_reminder_offsets"] == []
        finally:
            api.delete(f"{BASE_URL}/api/competitions/{cid}")


# ============================================================
# 2) parse_local_datetime unit tests
# ============================================================
class TestParseLocalDatetime:
    def test_iso_variants(self):
        from core.helpers import parse_local_datetime
        assert parse_local_datetime("2026-07-08T14:30") == datetime(2026, 7, 8, 14, 30)
        assert parse_local_datetime("2026-07-08 14:30") == datetime(2026, 7, 8, 14, 30)
        assert parse_local_datetime("2026-07-08") == datetime(2026, 7, 8, 0, 0)

    def test_freeform_variants(self):
        from core.helpers import parse_local_datetime
        # DD-MM-YYYY
        assert parse_local_datetime("08-07-2026 14:30") == datetime(2026, 7, 8, 14, 30)
        # DD/MM/YYYY (parser normalises / → -)
        assert parse_local_datetime("07/08/2026") == datetime(2026, 8, 7, 0, 0)

    def test_garbage_returns_none(self):
        from core.helpers import parse_local_datetime
        assert parse_local_datetime("") is None
        assert parse_local_datetime(None) is None
        assert parse_local_datetime("not a date") is None
        assert parse_local_datetime("2026-13-40") is None


# ============================================================
# 3) Scheduler tests (async, monkeypatched send_sms)
# ============================================================
class TestScheduler:
    def test_valid_offsets(self):
        from core.scheduler import _valid_offsets
        assert _valid_offsets([1, 15, 30, 60]) == [60, 30, 15, 1]
        # dedupe + strip disallowed
        assert _valid_offsets([60, 60, 30, 999, "15", "bad", None]) == [60, 30, 15]
        assert _valid_offsets(None) == []
        assert _valid_offsets([]) == []

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)

    def test_send_timed_sms_tick_dedupe_and_fire(self, monkeypatch, me):
        """Set up a competition with booking_release_at so (target-offset) is
        aligned with 'now' in the user's tz, run tick, assert send_sms called
        exactly once and second run is a no-op."""
        import core.scheduler as sched
        from core.db import db

        user_id = me["id"]

        calls = []

        def _fake_send_sms(to, body):
            calls.append((to, body))
            return True

        # IMPORTANT: monkeypatch both the sms module and the scheduler-imported name
        monkeypatch.setattr("core.sms.send_sms", _fake_send_sms)
        monkeypatch.setattr("core.scheduler.send_sms", _fake_send_sms)

        async def _run_all():
            # Save prefs to restore later
            orig_user = await db.users.find_one({"id": user_id}, {"_id": 0})
            orig_prefs = (orig_user or {}).get("notification_preferences") or {}
            try:
                # Enable SMS with a valid US number
                new_prefs = {
                    **orig_prefs,
                    "enabled": True,
                    "sms_enabled": True,
                    "sms_phone": "+15555550123",
                    "timezone": TZ_NAME,
                }
                await db.users.update_one({"id": user_id}, {"$set": {"notification_preferences": new_prefs}})

                # Compute a booking_release_at so that (target - 60min) == local now
                now_local = datetime.utcnow().replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(TZ_NAME)).replace(tzinfo=None, second=0, microsecond=0)
                # Target 60 minutes from now → offset 60 fires immediately.
                target = now_local + timedelta(minutes=60)
                target_str = target.strftime("%Y-%m-%dT%H:%M")

                comp_id = f"TEST_S1_{now_local.strftime('%H%M%S')}"
                comp_doc = {
                    "id": comp_id,
                    "user_id": user_id,
                    "name": "TEST_S1 Sched Comp",
                    "event_date": (now_local + timedelta(days=7)).date().isoformat(),
                    "booking_release_at": target_str,
                    "sms_reminder_offsets": [60, 30],  # only 60 should be due
                    "created_at": datetime.utcnow().isoformat() + "Z",
                }
                await db.competitions.insert_one(dict(comp_doc))

                try:
                    # Clean prior dedupe rows for this comp
                    await db.sent_notifications.delete_many({"key": {"$regex": f":comp:{comp_id}:"}})

                    # First tick → should fire exactly once (offset 60)
                    calls.clear()
                    await sched.send_timed_sms_tick()
                    assert len(calls) == 1, f"expected 1 call, got {len(calls)}: {calls}"
                    assert "opens in 1 hour" in calls[0][1]

                    # Dedupe row exists
                    row = await db.sent_notifications.find_one({"key": f"{user_id}:comp:{comp_id}:booking_open:60"}, {"_id": 0})
                    assert row is not None
                    assert row["kind"] == "sms_booking_open"

                    # Second tick → NO new send (dedupe)
                    calls.clear()
                    await sched.send_timed_sms_tick()
                    assert calls == [], f"expected dedupe, got {calls}"

                    # ---- Flight check-in path ----
                    # depart_time so that (depart - 24h - 15min) == now
                    dep = now_local + timedelta(minutes=(24 * 60) + 15)
                    booking_id = f"TEST_S1_BK_{now_local.strftime('%H%M%S')}"
                    bk_doc = {
                        "id": booking_id,
                        "user_id": user_id,
                        "competition_id": comp_id,
                        "type": "flight",
                        "depart_time": dep.strftime("%Y-%m-%dT%H:%M"),
                        "depart_airport": "LAX",
                        "arrive_airport": "HOU",
                        "sms_reminder_offsets": [15],
                        "created_at": datetime.utcnow().isoformat() + "Z",
                    }
                    await db.bookings.insert_one(dict(bk_doc))
                    try:
                        await db.sent_notifications.delete_many({"key": {"$regex": f":booking:{booking_id}:"}})
                        calls.clear()
                        await sched.send_timed_sms_tick()
                        # Booking check-in fires + competition already deduped
                        assert len(calls) == 1, f"expected flight check-in fire, got {calls}"
                        assert "Check-in" in calls[0][1] and "LAX" in calls[0][1] and "HOU" in calls[0][1]

                        row2 = await db.sent_notifications.find_one({"key": f"{user_id}:booking:{booking_id}:checkin_out:15"}, {"_id": 0})
                        assert row2 is not None and row2["kind"] == "sms_checkin"

                        # Rerun → dedupe
                        calls.clear()
                        await sched.send_timed_sms_tick()
                        assert calls == []
                    finally:
                        await db.bookings.delete_one({"id": booking_id})
                        await db.sent_notifications.delete_many({"key": {"$regex": f":booking:{booking_id}:"}})
                finally:
                    await db.competitions.delete_one({"id": comp_id})
                    await db.sent_notifications.delete_many({"key": {"$regex": f":comp:{comp_id}:"}})
            finally:
                # Restore original prefs
                if orig_user is not None:
                    await db.users.update_one({"id": user_id}, {"$set": {"notification_preferences": orig_prefs}})

        asyncio.run(_run_all())
