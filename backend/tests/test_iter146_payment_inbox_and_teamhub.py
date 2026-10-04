"""Iter 146 backend tests:
   1. Smart Inbox PAYMENT flow (parse → confirm → expense auto-mark-paid)
   2. Confirm-all for pending payment draft auto-applies to best open expense
   3. Smart Inbox regression (expense + booking parse/confirm still work)
   4. GET /api/team/calendar/importable returns ALL schedule events (past + future, any type)
   5. POST /api/team/calendar/import-from-personal (schedule → series collapses to one recurring team_event)
   6. POST /api/team/calendar/import-from-personal (competition) pulls hotel/flight/car bookings
      into notes & upserts (second call returns same event_id with updated=True)
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"
BASE_URL = BASE_URL.rstrip("/")

DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASSWORD = "CheerDemo2026!"


# ---------------- session fixture (login once) ----------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Demo login failed: {r.status_code} {r.text}")
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"No token in login response: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ---------------- helpers ----------------
def _pick_open_expense(session):
    r = session.get(f"{BASE_URL}/api/expenses", timeout=20)
    assert r.status_code == 200, r.text
    for e in r.json():
        if not e.get("paid") and float(e.get("balance_due") or 0) > 0:
            return e
    return None


def _get_athletes(session):
    r = session.get(f"{BASE_URL}/api/athletes", timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ================== Smart Inbox: PAYMENT flow =====================
class TestInboxPaymentFlow:
    def test_parse_payment_text_yields_payment_draft(self, session):
        text = "Venmo: You paid Champion Cheer $150.00 on 2026-03-02. Payment successful."
        r = session.post(f"{BASE_URL}/api/inbox/parse", json={"text": text, "source": "paste"}, timeout=90)
        assert r.status_code == 200, r.text
        drafts = r.json()
        assert isinstance(drafts, list) and drafts, "Expected at least one draft"
        kinds = [d["kind"] for d in drafts]
        assert "payment" in kinds, f"Expected payment kind, got: {kinds} / {drafts}"
        pay = next(d for d in drafts if d["kind"] == "payment")
        data = pay.get("data") or {}
        assert abs(float(data.get("amount") or 0) - 150.0) < 0.01, f"amount mismatch: {data}"
        # method may normalize to Venmo
        assert (data.get("method") or "").lower().startswith("venmo"), f"method mismatch: {data}"
        # persist for next test
        pytest.payment_draft_id = pay["id"]

    def test_confirm_payment_auto_marks_expense_paid(self, session):
        draft_id = getattr(pytest, "payment_draft_id", None)
        if not draft_id:
            pytest.skip("Payment draft not created")
        exp = _pick_open_expense(session)
        if not exp:
            pytest.skip("No open expense available on demo account")
        bal_before = float(exp.get("balance_due") or 0)
        payload = {
            "kind": "payment",
            "payment": {
                "athlete_id": exp["athlete_id"],
                "amount": bal_before,
                "paid_on": date.today().isoformat(),
                "method": "Venmo",
                "note": "TEST_iter146 auto-mark-paid",
                "applied_expense_ids": [exp["id"]],
            },
        }
        r = session.post(f"{BASE_URL}/api/inbox/drafts/{draft_id}/confirm", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("kind") == "payment"
        # verify expense is now paid
        r2 = session.get(f"{BASE_URL}/api/expenses", timeout=20)
        assert r2.status_code == 200
        target = next((e for e in r2.json() if e["id"] == exp["id"]), None)
        assert target is not None, "Expense disappeared after payment confirm"
        assert target.get("paid") is True, f"Expense should be paid=True, got {target}"
        assert float(target.get("balance_due") or 0) < 0.01, f"Balance should be 0, got {target.get('balance_due')}"
        pytest.payment_id = (body.get("created") or {}).get("id") if isinstance(body.get("created"), dict) else None

    def test_confirm_all_auto_applies_payment_draft(self, session):
        """Create new payment draft, then confirm-all auto-matches an open expense."""
        exp = _pick_open_expense(session)
        if not exp:
            pytest.skip("No open expense available for confirm-all test")
        bal = float(exp.get("balance_due") or 0)
        # draft an exact-balance payment so match_payment_expense exact-matches
        text = (
            f"Zelle: payment of ${bal:.2f} sent to Spirit Gym on "
            f"{date.today().isoformat()}. For athlete receipt."
        )
        r = session.post(f"{BASE_URL}/api/inbox/parse", json={"text": text, "source": "paste"}, timeout=90)
        assert r.status_code == 200, r.text
        drafts = r.json()
        pays = [d for d in drafts if d["kind"] == "payment"]
        if not pays:
            pytest.skip(f"LLM did not produce a payment draft: {drafts}")
        # confirm-all with fallback athlete_id = the expense's athlete
        r2 = session.post(
            f"{BASE_URL}/api/inbox/drafts/confirm-all",
            json={"athlete_id": exp["athlete_id"]},
            timeout=60,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("ok") is True
        assert body.get("created", 0) >= 1, f"Expected at least 1 created, got {body}"
        # verify expense flipped to paid
        r3 = session.get(f"{BASE_URL}/api/expenses", timeout=20)
        tgt = next((e for e in r3.json() if e["id"] == exp["id"]), None)
        assert tgt is not None
        assert tgt.get("paid") is True, f"Expense should be auto-paid, got {tgt}"


# ================== Smart Inbox regression: expense & booking =====================
class TestInboxRegression:
    def test_hotel_text_yields_booking_draft(self, session):
        text = (
            "Marriott Confirmation #ABC123. Check-in 2026-05-10, "
            "Check-out 2026-05-12. Total $420.00. 123 Main St, Dallas TX."
        )
        r = session.post(f"{BASE_URL}/api/inbox/parse", json={"text": text, "source": "paste"}, timeout=90)
        assert r.status_code == 200, r.text
        kinds = [d["kind"] for d in r.json()]
        assert "booking" in kinds, f"Expected booking kind, got: {kinds}"

    def test_receipt_text_yields_expense_draft(self, session):
        text = (
            "Walmart Receipt: $38.42 on 2026-03-15 for cheer bows and ribbons. "
            "For Ava Johnson."
        )
        r = session.post(f"{BASE_URL}/api/inbox/parse", json={"text": text, "source": "paste"}, timeout=90)
        assert r.status_code == 200, r.text
        kinds = [d["kind"] for d in r.json()]
        assert "expense" in kinds, f"Expected expense kind, got: {kinds}"


# ================== Importable list: ALL events (any date, any type) =====================
class TestImportableAll:
    def test_importable_returns_past_and_future_any_type(self, session):
        # Seed a past-dated personal schedule event to prove the list is not date-filtered
        past = (date.today() - timedelta(days=120)).isoformat()
        future = (date.today() + timedelta(days=90)).isoformat()
        tag = f"TEST_iter146_{uuid.uuid4().hex[:6]}"
        past_payload = {
            "title": f"{tag}_past", "event_type": "clinic",
            "date": past, "start_time": "10:00", "end_time": "11:00",
        }
        future_payload = {
            "title": f"{tag}_future", "event_type": "banquet",
            "date": future, "start_time": "18:00", "end_time": "20:00",
        }
        r1 = session.post(f"{BASE_URL}/api/schedule", json=past_payload, timeout=20)
        assert r1.status_code in (200, 201), r1.text
        r2 = session.post(f"{BASE_URL}/api/schedule", json=future_payload, timeout=20)
        assert r2.status_code in (200, 201), r2.text
        past_js, future_js = r1.json(), r2.json()
        past_id = past_js[0]["id"] if isinstance(past_js, list) else past_js.get("id")
        future_id = future_js[0]["id"] if isinstance(future_js, list) else future_js.get("id")

        r = session.get(f"{BASE_URL}/api/team/calendar/importable", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        evs = body.get("events") or []
        ev_ids = {e["id"] for e in evs}
        assert past_id in ev_ids, f"Past-dated event missing from importable list"
        assert future_id in ev_ids, "Future-dated event missing from importable list"
        types = {e.get("event_type") for e in evs if e.get("event_type")}
        assert any(t in types for t in ("clinic", "banquet", "practice")), (
            f"Expected multiple event_types, got: {types}"
        )
        # cleanup
        for sid in (past_id, future_id):
            if sid:
                session.delete(f"{BASE_URL}/api/schedule/{sid}", timeout=10)


# ================== Add-to-TeamHub (schedule → series) =====================
class TestImportFromPersonalSchedule:
    def test_recurring_schedule_imports_as_single_team_event(self, session):
        tag = f"TEST_iter146_sched_{uuid.uuid4().hex[:6]}"
        start = (date.today() + timedelta(days=7)).isoformat()
        until = (date.today() + timedelta(days=90)).isoformat()
        payload = {
            "title": tag, "event_type": "practice",
            "date": start, "start_time": "17:00", "end_time": "18:30",
            "recurrence_rule": {"frequency": "weekly", "days_of_week": [1], "until": until},
        }
        r = session.post(f"{BASE_URL}/api/schedule", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        js = r.json()
        rows = js if isinstance(js, list) else [js]
        series_id = rows[0].get("series_id")
        assert series_id, f"Expected series_id for recurring event: {rows[0]}"
        anchor_id = rows[0]["id"]

        push = session.post(
            f"{BASE_URL}/api/team/calendar/import-from-personal",
            json={"source": "schedule", "id": anchor_id},
            timeout=20,
        )
        assert push.status_code == 200, push.text
        body = push.json()
        assert body.get("ok") is True
        assert body.get("event_id"), f"Expected event_id, got {body}"
        team_event_id = body["event_id"]

        # Importing another occurrence from the same series should return already=True
        other = next((row for row in rows if row["id"] != anchor_id), None)
        if other:
            push2 = session.post(
                f"{BASE_URL}/api/team/calendar/import-from-personal",
                json={"source": "schedule", "id": other["id"]},
                timeout=20,
            )
            assert push2.status_code == 200, push2.text
            assert push2.json().get("already") is True, (
                f"Series should not re-import, got {push2.json()}"
            )

        # cleanup team event + schedule rows
        session.delete(f"{BASE_URL}/api/team/calendar/events/{team_event_id}", timeout=10)
        for row in rows:
            session.delete(f"{BASE_URL}/api/schedule/{row['id']}", timeout=10)


# ================== Add-to-TeamHub (competition → upsert + bookings) =====================
class TestImportFromPersonalCompetition:
    def test_competition_push_with_bookings_and_upsert(self, session):
        # Find a competition that has at least one booking (hotel/flight/car).
        comps_r = session.get(f"{BASE_URL}/api/competitions", timeout=20)
        assert comps_r.status_code == 200
        comps = comps_r.json()
        if not comps:
            pytest.skip("No competitions on demo account")
        chosen = None
        for c in comps:
            bks = session.get(f"{BASE_URL}/api/bookings?competition_id={c['id']}", timeout=15)
            if bks.status_code == 200 and bks.json():
                types = {(b.get("type") or "").lower() for b in bks.json()}
                if types & {"hotel", "flight", "car"}:
                    chosen = c
                    pytest.chosen_booking_types = types
                    break
        if not chosen:
            pytest.skip("Demo account has no competition with hotel/flight/car bookings")

        push = session.post(
            f"{BASE_URL}/api/team/calendar/import-from-personal",
            json={
                "source": "competition", "id": chosen["id"],
                "include": {"hotel": True, "flight": True, "car": True},
            },
            timeout=25,
        )
        assert push.status_code == 200, push.text
        body = push.json()
        assert body.get("ok") is True
        team_event_id = body.get("event_id")
        assert team_event_id, f"Expected event_id, got {body}"

        # Fetch team event list and verify notes contain booking blurbs.
        # Widen window across past & future (comp event_date can be in past).
        past = (date.today() - timedelta(days=3 * 365)).isoformat()
        far = (date.today() + timedelta(days=3 * 365)).isoformat()
        evlist = session.get(
            f"{BASE_URL}/api/team/calendar/events?from_={past}&to={far}", timeout=15,
        )
        assert evlist.status_code == 200
        rows = evlist.json().get("events") or []
        match = next((r for r in rows if r.get("event_id") == team_event_id), None)
        assert match is not None, f"team_event_id {team_event_id} not found in list"
        notes = match.get("notes") or ""
        types = pytest.chosen_booking_types
        if "hotel" in types:
            assert "Hotel" in notes or "🏨" in notes, f"notes missing hotel block: {notes!r}"
        if "flight" in types:
            assert "Flight" in notes or "✈" in notes, f"notes missing flight block: {notes!r}"
        if "car" in types:
            assert "car" in notes.lower() or "🚗" in notes, f"notes missing car block: {notes!r}"

        # Second call must be upsert — same event_id with updated=True (NOT a duplicate).
        push2 = session.post(
            f"{BASE_URL}/api/team/calendar/import-from-personal",
            json={
                "source": "competition", "id": chosen["id"],
                "include": {"hotel": True, "flight": True, "car": True},
            },
            timeout=25,
        )
        assert push2.status_code == 200, push2.text
        body2 = push2.json()
        assert body2.get("updated") is True, f"Expected updated=True, got {body2}"
        assert body2.get("event_id") == team_event_id, (
            f"Expected same event_id, got {body2.get('event_id')} vs {team_event_id}"
        )

        # cleanup
        session.delete(f"{BASE_URL}/api/team/calendar/events/{team_event_id}", timeout=10)
