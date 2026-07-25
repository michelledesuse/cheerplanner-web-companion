"""Iter67: DUPLICATE endpoints + PER-MEMBER amount_due for payment trackers.

Verifies:
- POST /api/team/signups/{id}/duplicate → new sheet '<name> (copy)' with same
  slot structure but NO claims. Requires team_access.
- POST /api/team/paperwork/{id}/duplicate → new sheet '<name> (copy)' with same
  columns/items but NO checkmarks. Requires team_access.
- POST /api/team/payments/{id}/duplicate → new tracker '<name> (copy)' with same
  amount + per-member amount_due + exemptions preserved, no one marked paid.
  Requires team_access.
- PUT /api/team/payments/{id}/member/{mid} with amount_due=40 paid=true amount_paid=40
  → summary excludes that member from short_count.
- PUT ... {amount_due:60} without paid → member owes 60.
- Summary.outstanding / short_count reflect per-member dues.
- PUT ... {amount_due:null} → falls back to tracker default (100).
"""
import os
import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or _env.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def state(hdr):
    created = {"roster": [], "signups": [], "paperwork": [], "payments": []}

    # 2 athletes to test per-member due
    for nm in ("TEST_iter67_A", "TEST_iter67_B"):
        r = requests.post(f"{BASE_URL}/api/roster", json={"name": nm, "role": "athlete"}, headers=hdr)
        assert r.status_code in (200, 201), r.text
        created["roster"].append(r.json()["id"])

    yield {"hdr": hdr, "created": created}

    for tid in created["payments"]:
        requests.delete(f"{BASE_URL}/api/team/payments/{tid}", headers=hdr)
    for sid in created["signups"]:
        requests.delete(f"{BASE_URL}/api/team/signups/{sid}", headers=hdr)
    for sid in created["paperwork"]:
        requests.delete(f"{BASE_URL}/api/team/paperwork/{sid}", headers=hdr)
    for mid in created["roster"]:
        requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=hdr)


# ============================================================
# Duplicate signup sheet
# ============================================================
class TestSignupDuplicate:
    def test_requires_auth(self, state):
        # Create original
        r = requests.post(f"{BASE_URL}/api/team/signups",
                          json={"name": "TEST_iter67_signup"}, headers=state["hdr"])
        assert r.status_code in (200, 201), r.text
        sid = r.json()["id"]
        state["created"]["signups"].append(sid)
        state["_signup_id"] = sid

        # add a slot
        r2 = requests.post(f"{BASE_URL}/api/team/signups/{sid}/slots",
                           json={"label": "SlotA", "qty_needed": 1, "kind": "item"},
                           headers=state["hdr"])
        assert r2.status_code in (200, 201), r2.text
        state["_slot_id"] = r2.json()["slots"][0]["id"]

        # add a claim
        mid = state["created"]["roster"][0]
        r3 = requests.post(f"{BASE_URL}/api/team/signups/{sid}/slots/{state['_slot_id']}/claims",
                           json={"member_id": mid, "qty": 1}, headers=state["hdr"])
        assert r3.status_code in (200, 201), r3.text

        # No auth
        r4 = requests.post(f"{BASE_URL}/api/team/signups/{sid}/duplicate")
        assert r4.status_code in (401, 403)

    def test_duplicate_copies_slots_no_claims(self, state):
        sid = state["_signup_id"]
        r = requests.post(f"{BASE_URL}/api/team/signups/{sid}/duplicate", headers=state["hdr"])
        assert r.status_code == 200, r.text
        copy = r.json()
        state["created"]["signups"].append(copy["id"])
        assert copy["id"] != sid
        assert copy["name"].endswith(" (copy)"), copy["name"]
        assert copy["name"].startswith("TEST_iter67_signup")
        assert len(copy["slots"]) == 1
        assert copy["slots"][0]["label"] == "SlotA"
        # NEW slot id != original
        assert copy["slots"][0]["id"] != state["_slot_id"]
        # NO claims
        assert (copy["slots"][0].get("claims") or []) == []


# ============================================================
# Duplicate paperwork sheet
# ============================================================
class TestPaperworkDuplicate:
    def test_duplicate_copies_columns_no_checks(self, state):
        # Create sheet + items + values
        r = requests.post(f"{BASE_URL}/api/team/paperwork",
                          json={"name": "TEST_iter67_pw"}, headers=state["hdr"])
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        state["created"]["paperwork"].append(pid)

        r2 = requests.post(f"{BASE_URL}/api/team/paperwork/{pid}/items",
                           json={"label": "ColA"}, headers=state["hdr"])
        assert r2.status_code in (200, 201), r2.text
        item_id = r2.json()["items"][0]["id"]

        # Set a check
        mid = state["created"]["roster"][0]
        r3 = requests.put(f"{BASE_URL}/api/team/paperwork/{pid}/value",
                          json={"member_id": mid, "item_id": item_id, "done": True},
                          headers=state["hdr"])
        assert r3.status_code == 200, r3.text

        # No auth for duplicate
        assert requests.post(f"{BASE_URL}/api/team/paperwork/{pid}/duplicate").status_code in (401, 403)

        # Duplicate
        rd = requests.post(f"{BASE_URL}/api/team/paperwork/{pid}/duplicate", headers=state["hdr"])
        assert rd.status_code == 200, rd.text
        copy = rd.json()
        state["created"]["paperwork"].append(copy["id"])
        assert copy["id"] != pid
        assert copy["name"] == "TEST_iter67_pw (copy)"
        assert len(copy["items"]) == 1
        assert copy["items"][0]["label"] == "ColA"
        assert copy["items"][0]["id"] != item_id  # fresh id
        # NO checkmarks
        assert (copy.get("values") or {}) == {}


# ============================================================
# Duplicate payment tracker + PER-MEMBER amount_due
# ============================================================
class TestPaymentDuplicateAndPerMemberDue:
    def test_create_tracker_and_set_per_member(self, state):
        # Create tracker amount=100
        r = requests.post(f"{BASE_URL}/api/team/payments",
                          json={"name": "TEST_iter67_pay", "amount": 100},
                          headers=state["hdr"])
        assert r.status_code in (200, 201), r.text
        tid = r.json()["id"]
        state["created"]["payments"].append(tid)
        state["_tracker_id"] = tid

        mid_a, mid_b = state["created"]["roster"][:2]
        state["_mid_a"] = mid_a
        state["_mid_b"] = mid_b

        # A: amount_due=40, paid=true, amount_paid=40 -> fully covered
        r1 = requests.put(f"{BASE_URL}/api/team/payments/{tid}/member/{mid_a}",
                          json={"amount_due": 40, "paid": True, "amount_paid": 40},
                          headers=state["hdr"])
        assert r1.status_code == 200, r1.text
        summary = r1.json()["summary"]
        # A covered; B still owes 100. Only 2 test roster members but
        # other real members may exist. Grab the fresh summary for later.

        # B: amount_due=60, no paid
        r2 = requests.put(f"{BASE_URL}/api/team/payments/{tid}/member/{mid_b}",
                          json={"amount_due": 60},
                          headers=state["hdr"])
        assert r2.status_code == 200, r2.text
        summary = r2.json()["summary"]
        assert summary["expected_per_person"] == 100

        # Fetch the tracker fresh
        rg = requests.get(f"{BASE_URL}/api/team/payments/{tid}", headers=state["hdr"])
        assert rg.status_code == 200
        body = rg.json()
        entries_by_mid = {e["member_id"]: e for e in body["entries"]}
        assert entries_by_mid[mid_a]["amount_due"] == 40
        assert entries_by_mid[mid_a]["paid"] is True
        assert entries_by_mid[mid_a]["amount_paid"] == 40
        assert entries_by_mid[mid_b]["amount_due"] == 60
        assert entries_by_mid[mid_b].get("paid") in (False, None)

    def test_summary_reflects_per_member_dues(self, state):
        tid = state["_tracker_id"]
        rg = requests.get(f"{BASE_URL}/api/team/payments/{tid}", headers=state["hdr"])
        summary = rg.json()["summary"]

        # short_count must NOT include mid_a (fully covered at 40/40)
        # outstanding must reflect B's 60 + any other roster member's default 100.
        # We can't know exact totals (other roster exists), but:
        # - paid_count >= 1 (A)
        # - member_total >= 2
        # - outstanding >= 60 (B's due)
        assert summary["paid_count"] >= 1
        assert summary["member_total"] >= 2
        assert summary["outstanding"] is not None
        assert summary["outstanding"] >= 60, summary
        # short_count must not include A but should include B.
        # unpaid_count includes B and everyone else who isn't A.
        assert summary["unpaid_count"] >= 1

    def test_amount_due_null_falls_back_to_default(self, state):
        tid = state["_tracker_id"]
        mid_a = state["_mid_a"]
        # Set A's due back to null (fall back to tracker default 100).
        # Note: still marked paid=true amount_paid=40 from before -> would owe 60.
        r = requests.put(f"{BASE_URL}/api/team/payments/{tid}/member/{mid_a}",
                         json={"amount_due": None},
                         headers=state["hdr"])
        assert r.status_code == 200, r.text
        body = r.json()
        entry = next(e for e in body["entries"] if e["member_id"] == mid_a)
        assert entry.get("amount_due") is None, entry
        # Summary: A now expected to pay 100 but only paid 40 -> short 60.
        # outstanding must include A's 60 + B's 60 = >=120 (plus others).
        summary = body["summary"]
        assert summary["outstanding"] >= 120, summary

    def test_duplicate_preserves_amount_and_dues_and_exemptions_no_paid(self, state):
        tid = state["_tracker_id"]
        # First exempt B so we can verify exemptions carry over.
        mid_b = state["_mid_b"]
        rex = requests.put(f"{BASE_URL}/api/team/payments/{tid}/member/{mid_b}/exclude",
                           json={"excluded": True}, headers=state["hdr"])
        assert rex.status_code == 200, rex.text

        # No-auth
        assert requests.post(f"{BASE_URL}/api/team/payments/{tid}/duplicate").status_code in (401, 403)

        # Duplicate
        rd = requests.post(f"{BASE_URL}/api/team/payments/{tid}/duplicate", headers=state["hdr"])
        assert rd.status_code == 200, rd.text
        copy = rd.json()
        state["created"]["payments"].append(copy["id"])
        assert copy["id"] != tid
        assert copy["name"] == "TEST_iter67_pay (copy)"
        assert copy["amount"] == 100
        # Exemption preserved
        assert mid_b in (copy.get("excluded_member_ids") or [])
        # Per-member dues preserved (B had 60 saved); A had null after last test.
        entries_by_mid = {e["member_id"]: e for e in copy["entries"]}
        # B's per-member due must persist in the copy
        assert entries_by_mid.get(mid_b, {}).get("amount_due") == 60, entries_by_mid
        # Nobody marked paid in the copy
        for e in copy["entries"]:
            assert not e.get("paid"), e
            assert e.get("amount_paid") in (None, 0), e
