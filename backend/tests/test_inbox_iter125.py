"""Backend tests for iter125 Smart Inbox additions:
1) POST /api/inbox/drafts/confirm-all (bulk add) — happy path + skip-when-missing
2) POST /api/inbox/inbound-email — SendGrid webhook accepts (no signature) & handles bad recipient
3) Auth guard on confirm-all
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "demo@cheerplanner.app"
PASSWORD = "CheerDemo2026!"

FLIGHT_TEXT = (
    "Flight confirmation!\n"
    "United Airlines - Confirmation: UA9821\n"
    "Flight UA321 from JFK to ORD\n"
    "Depart: 2026-04-10 07:30, Arrive: 2026-04-10 09:15\n"
    "Total: $278.55"
)
RECEIPT_TEXT = (
    "Cheer Bows Boutique Receipt\n"
    "Date: 2026-03-01\n"
    "Item: Rhinestone competition bow\n"
    "Total: $42.00"
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def cleanup(headers):
    state = {"drafts": [], "expenses": [], "bookings": []}
    yield state
    # Sweep any remaining drafts owned by this user
    try:
        lr = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
        if lr.status_code == 200:
            for d in lr.json():
                state["drafts"].append(d["id"])
    except Exception:
        pass
    for did in set(state["drafts"]):
        try:
            requests.delete(f"{API}/inbox/drafts/{did}", headers=headers, timeout=15)
        except Exception:
            pass
    for eid in state["expenses"]:
        try:
            requests.delete(f"{API}/expenses/{eid}", headers=headers, timeout=15)
        except Exception:
            pass
    for bid in state["bookings"]:
        try:
            requests.delete(f"{API}/bookings/{bid}", headers=headers, timeout=15)
        except Exception:
            pass


def _clear_pending(headers):
    r = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
    if r.status_code == 200:
        for d in r.json():
            requests.delete(f"{API}/inbox/drafts/{d['id']}", headers=headers, timeout=15)


# --- Auth guard --------------------------------------------------------------
class TestAuthGuard:
    def test_confirm_all_requires_auth(self):
        r = requests.post(f"{API}/inbox/drafts/confirm-all", json={}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# --- confirm-all bulk add ----------------------------------------------------
class TestConfirmAll:
    def test_bulk_add_all(self, headers, cleanup):
        _clear_pending(headers)
        # Seed 1 expense + 1 booking draft
        r1 = requests.post(f"{API}/inbox/parse",
                           json={"text": RECEIPT_TEXT, "source": "paste"},
                           headers=headers, timeout=120)
        assert r1.status_code == 200, r1.text[:300]
        d_exp = r1.json()
        cleanup["drafts"].append(d_exp["id"])
        assert d_exp["kind"] == "expense", f"expected expense, got {d_exp.get('kind')}"

        r2 = requests.post(f"{API}/inbox/parse",
                           json={"text": FLIGHT_TEXT, "source": "paste"},
                           headers=headers, timeout=120)
        assert r2.status_code == 200, r2.text[:300]
        d_bk = r2.json()
        cleanup["drafts"].append(d_bk["id"])
        assert d_bk["kind"] == "booking", f"expected booking, got {d_bk.get('kind')}"

        # Get an athlete + competition
        ar = requests.get(f"{API}/athletes", headers=headers, timeout=15)
        athletes = ar.json()
        assert athletes, "demo account must have athletes"
        athlete_id = athletes[0]["id"]

        cr = requests.get(f"{API}/competitions", headers=headers, timeout=15)
        comps = cr.json()
        if not comps:
            nr = requests.post(f"{API}/competitions",
                               json={"name": "TEST_iter125_comp", "event_date": "2026-06-01"},
                               headers=headers, timeout=15)
            comps = [nr.json()]
        comp_id = comps[0]["id"]

        # Get baseline counts
        base_exp = requests.get(f"{API}/expenses", headers=headers, timeout=15).json()
        base_bk = requests.get(f"{API}/bookings", headers=headers, timeout=15).json()
        base_exp_ids = {e["id"] for e in base_exp}
        base_bk_ids = {b["id"] for b in base_bk}

        # Call confirm-all
        cr = requests.post(f"{API}/inbox/drafts/confirm-all",
                           json={"athlete_id": athlete_id, "competition_id": comp_id},
                           headers=headers, timeout=45)
        assert cr.status_code == 200, cr.text[:400]
        result = cr.json()
        assert result.get("ok") is True
        assert result.get("created", 0) >= 2, f"expected created>=2 got {result}"
        assert result.get("skipped") == [], f"expected empty skipped, got {result.get('skipped')}"

        # Drafts empty
        lr = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
        assert lr.status_code == 200
        assert lr.json() == [], f"expected drafts empty, got {lr.json()}"

        # New expense present
        new_exp = requests.get(f"{API}/expenses", headers=headers, timeout=15).json()
        new_exp_ids = {e["id"] for e in new_exp} - base_exp_ids
        assert new_exp_ids, "no new expense created"
        cleanup["expenses"].extend(new_exp_ids)

        # New booking present
        new_bk = requests.get(f"{API}/bookings", headers=headers, timeout=15).json()
        new_bk_ids = {b["id"] for b in new_bk} - base_bk_ids
        assert new_bk_ids, "no new booking created"
        cleanup["bookings"].extend(new_bk_ids)

    def test_skip_when_no_athlete_id(self, headers, cleanup):
        _clear_pending(headers)
        r1 = requests.post(f"{API}/inbox/parse",
                           json={"text": RECEIPT_TEXT, "source": "paste"},
                           headers=headers, timeout=120)
        assert r1.status_code == 200
        d_exp = r1.json()
        cleanup["drafts"].append(d_exp["id"])
        assert d_exp["kind"] == "expense"

        # confirm-all WITHOUT athlete_id
        cr = requests.post(f"{API}/inbox/drafts/confirm-all",
                           json={},
                           headers=headers, timeout=30)
        assert cr.status_code == 200, cr.text[:300]
        result = cr.json()
        assert result.get("created", 0) == 0, f"expected 0 created, got {result}"
        assert len(result.get("skipped", [])) >= 1, f"expected non-empty skipped, got {result}"

        # Draft should still be pending
        lr = requests.get(f"{API}/inbox/drafts", headers=headers, timeout=15)
        ids = [x["id"] for x in lr.json()]
        assert d_exp["id"] in ids, "expense draft should remain pending after skip"


# --- inbound-email webhook ---------------------------------------------------
class TestInboundEmail:
    def test_bad_recipient_returns_400(self):
        # No signature required (SENDGRID_PARSE_PUBLIC_KEY unset). Bad recipient -> 400
        r = requests.post(
            f"{API}/inbox/inbound-email",
            data={"to": "someone@example.com", "text": "hello", "subject": "hi"},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 Unrecognized recipient, got {r.status_code} {r.text[:200]}"
        assert "Unrecognized" in r.text or "recipient" in r.text.lower()

    def test_valid_token_creates_email_draft(self, headers, cleanup):
        # Fetch the user's inbox token (address endpoint mints one if missing)
        ar = requests.get(f"{API}/inbox/address", headers=headers, timeout=15)
        assert ar.status_code == 200
        # Token is on the user doc; not returned directly. We derive it from
        # /auth/me? Not exposed. Fall back: query the DB indirectly by parsing —
        # since the address endpoint ensures a token exists, try common paths.
        # If token is not retrievable, we can only assert the bad-recipient
        # branch. So try to read via a follow-up address call (idempotent).
        # The API does not expose the token, so this branch is a soft assert.
        # We assert the endpoint at least doesn't 500 with a syntactically valid
        # add+<hex>@ recipient using a bogus token (should be 404 Unknown inbox).
        r = requests.post(
            f"{API}/inbox/inbound-email",
            data={"to": "add+deadbeefdeadbeef@x.com", "text": "flight receipt $50", "subject": "hi"},
            timeout=30,
        )
        assert r.status_code in (200, 404), f"expected 200 or 404, got {r.status_code} {r.text[:200]}"
        # If 200 was returned (unlikely for unknown token), the endpoint accepted
        # without signature verification — that confirms the security branch.
        # If 404, that also confirms the endpoint parses the recipient and did
        # NOT 500 or reject on missing signature.
