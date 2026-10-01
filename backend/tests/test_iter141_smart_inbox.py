"""Backend tests for iter141: Smart Inbox enhancements.

Covers:
- Smarter Dates: booking draft auto-attaches to competition whose dates line up.
- Forward Receipts: receipt draft auto-attaches to athlete named on receipt.
- Duplicate Guard: dup-check endpoint + confirm-all reports duplicates.
- Regression: /api/inbox/parse returns ARRAY, /api/inbox/drafts list, login 200.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "demo@cheerplanner.app"
PASSWORD = "CheerDemo2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"no token in {r.json()}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def ctx(session):
    """Create a competition and an athlete to attach test items to.
    Yields a dict and cleans up at the end (including any drafts/bookings/expenses we created)."""
    created = {"comp_id": None, "athlete_id": None, "draft_ids": [], "booking_ids": [], "expense_ids": [], "owns_comp": False, "owns_athlete": False}

    # Create competition
    r = session.post(f"{BASE_URL}/api/competitions", json={
        "name": "TEST_IT141_Comp",
        "event_date": "2026-03-15",
        "end_date": "2026-03-16",
    }, timeout=15)
    assert r.status_code in (200, 201), f"comp create failed: {r.status_code} {r.text}"
    created["comp_id"] = r.json()["id"]
    created["owns_comp"] = True

    # Create athlete
    r = session.post(f"{BASE_URL}/api/athletes", json={"name": "TEST_IT141_Emma Johnson"}, timeout=15)
    assert r.status_code in (200, 201), f"athlete create failed: {r.status_code} {r.text}"
    created["athlete_id"] = r.json()["id"]
    created["owns_athlete"] = True

    yield created

    # ---- cleanup ----
    for bid in created["booking_ids"]:
        try: session.delete(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        except Exception: pass
    for eid in created["expense_ids"]:
        try: session.delete(f"{BASE_URL}/api/expenses/{eid}", timeout=15)
        except Exception: pass
    # catch-all: any bookings/expenses on the test competition/athlete
    try:
        bs = session.get(f"{BASE_URL}/api/bookings", params={"competition_id": created["comp_id"]}, timeout=15).json()
        for b in bs:
            session.delete(f"{BASE_URL}/api/bookings/{b['id']}", timeout=15)
    except Exception: pass
    try:
        es = session.get(f"{BASE_URL}/api/expenses", timeout=15).json()
        for e in es:
            if e.get("athlete_id") == created["athlete_id"]:
                session.delete(f"{BASE_URL}/api/expenses/{e['id']}", timeout=15)
    except Exception: pass
    for did in created["draft_ids"]:
        try: session.delete(f"{BASE_URL}/api/inbox/drafts/{did}", timeout=15)
        except Exception: pass
    # Also sweep any leftover pending drafts for this user
    try:
        drafts = session.get(f"{BASE_URL}/api/inbox/drafts", timeout=15).json()
        for d in drafts:
            session.delete(f"{BASE_URL}/api/inbox/drafts/{d['id']}", timeout=15)
    except Exception: pass
    if created["owns_comp"]:
        try: session.delete(f"{BASE_URL}/api/competitions/{created['comp_id']}", timeout=15)
        except Exception: pass
    if created["owns_athlete"]:
        try: session.delete(f"{BASE_URL}/api/athletes/{created['athlete_id']}", timeout=15)
        except Exception: pass


# ----------- Regression: parse returns ARRAY, login works, drafts list -----------
def test_login_200(session):
    r = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200


def test_drafts_list_works(session):
    r = session.get(f"{BASE_URL}/api/inbox/drafts", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def _parse(session, text):
    r = session.post(f"{BASE_URL}/api/inbox/parse", json={"text": text, "source": "paste"}, timeout=90)
    assert r.status_code == 200, f"parse failed {r.status_code} {r.text}"
    out = r.json()
    assert isinstance(out, list), f"inbox/parse must return ARRAY, got {type(out)}"
    assert len(out) >= 1
    return out


# ----------- Smarter Dates + Forward Receipts via confirm-all -----------
HOTEL_TEXT = (
    "Marriott Hotel Reservation Confirmation\n"
    "Confirmation #: HTLABC12345\n"
    "Guest: Taylor Smith\n"
    "Address: 123 Main Street, Dallas, TX\n"
    "Check-in: Saturday, March 14, 2026 at 3:00 PM\n"
    "Check-out: Monday, March 16, 2026 at 11:00 AM\n"
    "Total: $420.00\n"
    "Free cancellation by March 10, 2026\n"
)

RECEIPT_TEXT = (
    "Payment Receipt\n"
    "Thanks! Payment received for TEST_IT141_Emma Johnson tuition.\n"
    "Amount: $150.00\n"
    "Date: 2026-01-15\n"
    "Vendor: AllStars Gym\n"
    "Category: Tuition\n"
)

CAR_TEXT = (
    "Hertz Rental Car Reservation\n"
    "Confirmation #: CARXYZ99\n"
    "Pickup: 2026-03-14 10:00 at Dallas DFW Airport\n"
    "Drop-off: 2026-03-16 18:00 at Dallas DFW Airport\n"
    "Total: $180.00\n"
)


def test_smarter_dates_and_forward_receipts_confirm_all(session, ctx):
    comp_id = ctx["comp_id"]
    athlete_id = ctx["athlete_id"]

    # Create pending drafts via /api/inbox/parse
    hotel_drafts = _parse(session, HOTEL_TEXT)
    ctx["draft_ids"] += [d["id"] for d in hotel_drafts]
    receipt_drafts = _parse(session, RECEIPT_TEXT)
    ctx["draft_ids"] += [d["id"] for d in receipt_drafts]

    # Give a moment, then confirm-all with EMPTY body (no athlete_id / competition_id)
    r = session.post(f"{BASE_URL}/api/inbox/drafts/confirm-all", json={}, timeout=60)
    assert r.status_code == 200, f"confirm-all failed {r.status_code} {r.text}"
    out = r.json()
    assert out.get("ok") is True
    created = out.get("created", 0)
    assert created >= 2, f"expected >=2 auto-created; got {created}. skipped={out.get('skipped')} dups={out.get('duplicates')}"

    # Verify hotel booking landed on the right competition
    bk = session.get(f"{BASE_URL}/api/bookings", params={"competition_id": comp_id}, timeout=15)
    assert bk.status_code == 200
    bookings = bk.json()
    hotel_bookings = [b for b in bookings if b.get("type") == "hotel"]
    assert len(hotel_bookings) >= 1, f"no hotel booking found on competition {comp_id}: {bookings}"
    ctx["booking_ids"] += [b["id"] for b in bookings]

    # Verify expense landed on the right athlete
    ex = session.get(f"{BASE_URL}/api/expenses", timeout=15)
    assert ex.status_code == 200
    expenses = ex.json()
    mine = [e for e in expenses if e.get("athlete_id") == athlete_id]
    assert len(mine) >= 1, f"no expense auto-attached to athlete {athlete_id}; expenses(sample)={expenses[:3]}"
    ctx["expense_ids"] += [e["id"] for e in mine]


# ----------- Duplicate Guard -----------
def test_duplicate_guard_dupcheck_and_confirm_all(session, ctx):
    comp_id = ctx["comp_id"]

    # Parse SAME hotel again → new pending draft
    hotel_drafts_v2 = _parse(session, HOTEL_TEXT)
    ctx["draft_ids"] += [d["id"] for d in hotel_drafts_v2]
    dup_draft = next((d for d in hotel_drafts_v2 if d.get("kind") == "booking"), None)
    assert dup_draft is not None, f"no booking draft produced: {hotel_drafts_v2}"

    # dup-check should return duplicate:true
    r = session.get(f"{BASE_URL}/api/inbox/drafts/{dup_draft['id']}/dup-check",
                    params={"competition_id": comp_id}, timeout=15)
    assert r.status_code == 200
    assert r.json().get("duplicate") is True, f"expected duplicate:true, got {r.json()}"

    # Parse a different booking (car) → dup-check should be false
    car_drafts = _parse(session, CAR_TEXT)
    ctx["draft_ids"] += [d["id"] for d in car_drafts]
    car_draft = next((d for d in car_drafts if d.get("kind") == "booking"), None)
    assert car_draft is not None
    r = session.get(f"{BASE_URL}/api/inbox/drafts/{car_draft['id']}/dup-check",
                    params={"competition_id": comp_id}, timeout=15)
    assert r.status_code == 200
    assert r.json().get("duplicate") is False, f"expected duplicate:false for car, got {r.json()}"

    # confirm-all again → the duplicate hotel should land in `duplicates`, car gets created
    r = session.post(f"{BASE_URL}/api/inbox/drafts/confirm-all", json={}, timeout=60)
    assert r.status_code == 200
    out = r.json()
    dups = out.get("duplicates") or []
    assert len(dups) >= 1, f"expected a duplicate entry; got {out}"

    # Hotel bookings on comp should still be 1 (not duplicated)
    bk = session.get(f"{BASE_URL}/api/bookings", params={"competition_id": comp_id}, timeout=15).json()
    hotels = [b for b in bk if b.get("type") == "hotel"]
    assert len(hotels) == 1, f"duplicate hotel should NOT have been created; got {len(hotels)} hotels"
    # pick up car for cleanup
    ctx["booking_ids"] += [b["id"] for b in bk if b["id"] not in ctx["booking_ids"]]
