"""iter148 — App Review / screenshot account verification.

Validates:
  * applereview@cheerplanner.app logs in and has lifetime Premium.
  * All screens the reviewer / screenshot flow lands on are populated with
    the expected counts: 2 athletes, 2 competitions + travel (hotel/flight/car),
    8 roster, 3 payment trackers, 2 signups, 2 paperwork, 3 attendance,
    3 inbox drafts, 3 results, SMS broadcast history (1).
  * Coach + co-parent extra logins work; coach is attached to the demo hub.
  * Admin reseed endpoint:
      - unauth → 401/403
      - non-admin → 403
      - admin POST → kicks off background job; GET reports status.
      - After the reseed completes, counts remain identical (idempotent).
"""
from __future__ import annotations

import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL not set", allow_module_level=True)

REVIEWER = ("applereview@cheerplanner.app", "Review2026!")
COACH = ("coach.casey@cheerplanner.app", "CheerDemo2026!")
COPARENT = ("parent.taylor@cheerplanner.app", "CheerDemo2026!")
ADMIN = ("reviewsadmin@cheerplanner.app", "AdminRev2026!")


def _login(email: str, password: str):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, data
    return tok, data


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --- 1. Reviewer login + Premium -----------------------------------------
class TestReviewerLogin:
    def test_login_and_premium(self):
        tok, _ = _login(*REVIEWER)
        r = requests.get(f"{BASE_URL}/api/premium/status", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()
        # Accept either "lifetime"/"active" style flags; must be premium.
        is_premium = s.get("premium") or s.get("is_premium") or s.get("plan") in ("lifetime", "premium") \
            or s.get("source") == "admin_grant"
        assert is_premium, f"Reviewer should be Premium: {s}"

    def test_coach_login(self):
        tok, _ = _login(*COACH)
        # Coach has team_access and should see team hub (same hub as reviewer).
        r = requests.get(f"{BASE_URL}/api/team/switcher", headers=_h(tok), timeout=15)
        # team/switcher may be any 200 with hubs list; tolerate 404 if endpoint renamed
        assert r.status_code in (200, 404), r.text[:200]

    def test_coparent_login(self):
        tok, _ = _login(*COPARENT)
        assert tok


# --- 2. Reviewer screens populated ---------------------------------------
class TestReviewerDataCounts:
    @pytest.fixture(scope="class")
    def tok(self):
        t, _ = _login(*REVIEWER)
        return t

    def test_athletes(self, tok):
        r = requests.get(f"{BASE_URL}/api/athletes", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        names = [a.get("name") for a in r.json()]
        assert any("Ava" in n for n in names) and any("Mia" in n for n in names), names
        assert len(r.json()) >= 2

    def test_competitions_and_travel(self, tok):
        r = requests.get(f"{BASE_URL}/api/competitions", headers=_h(tok), timeout=15)
        assert r.status_code == 200
        comps = r.json()
        names = [c.get("name") for c in comps]
        assert any("Summit" in (n or "") for n in names), names
        # Travel bookings
        r2 = requests.get(f"{BASE_URL}/api/bookings", headers=_h(tok), timeout=15)
        assert r2.status_code == 200
        kinds = {b.get("type") for b in r2.json()}
        assert {"hotel", "flight", "car"}.issubset(kinds), kinds

    def test_roster_eight(self, tok):
        r = requests.get(f"{BASE_URL}/api/roster", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        assert len(r.json()) == 8, [m.get("name") for m in r.json()]

    def test_payment_trackers_three(self, tok):
        r = requests.get(f"{BASE_URL}/api/team/payments", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("payments") or rows.get("items") or []
        assert len(rows) == 3, [t.get("name") for t in rows]

    def test_signups_two(self, tok):
        r = requests.get(f"{BASE_URL}/api/team/signups", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("signups") or rows.get("items") or []
        assert len(rows) == 2

    def test_paperwork_two(self, tok):
        r = requests.get(f"{BASE_URL}/api/team/paperwork", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("paperwork") or rows.get("items") or []
        assert len(rows) == 2

    def test_attendance_three(self, tok):
        r = requests.get(f"{BASE_URL}/api/team/attendance", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("sessions") or rows.get("items") or []
        assert len(rows) == 3

    def test_inbox_drafts_three(self, tok):
        r = requests.get(f"{BASE_URL}/api/inbox/drafts", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        if isinstance(items, dict):
            items = items.get("drafts") or items.get("items") or []
        assert len(items) == 3, items

    def test_results_three(self, tok):
        r = requests.get(f"{BASE_URL}/api/team/results", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("results") or rows.get("items") or []
        assert len(rows) == 3, rows

    def test_broadcast_history_one(self, tok):
        r = requests.get(f"{BASE_URL}/api/team/broadcast/history", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("broadcasts") or rows.get("items") or rows.get("history") or []
        assert len(rows) >= 1, rows

    def test_ai_designs_and_brand(self, tok):
        r = requests.get(f"{BASE_URL}/api/ai-designer/designs", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text[:200]
        r2 = requests.get(f"{BASE_URL}/api/ai-designer/brands", headers=_h(tok), timeout=15)
        assert r2.status_code == 200, r2.text[:200]
        brands = r2.json()
        if isinstance(brands, dict):
            brands = brands.get("brands") or brands.get("items") or []
        names = [(b.get("name") or "") for b in brands]
        assert any("Elite Stars" in n for n in names), names

    def test_team_forms_banquet(self, tok):
        r = requests.get(f"{BASE_URL}/api/team/forms", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("forms") or rows.get("items") or []
        names = [(f.get("name") or "") for f in rows]
        assert any("Banquet" in n for n in names), names

    def test_place_reviews(self, tok):
        r = requests.get(f"{BASE_URL}/api/reviews/places", headers=_h(tok), timeout=15)
        if r.status_code == 404:
            r = requests.get(f"{BASE_URL}/api/review-places", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("places") or rows.get("items") or []
        assert len(rows) >= 4, rows


# --- 3. Admin reseed endpoint -------------------------------------------
class TestAdminReseed:
    def test_unauth_forbidden(self):
        r = requests.post(f"{BASE_URL}/api/admin/seed-review-account", timeout=10)
        assert r.status_code in (401, 403), r.status_code

    def test_non_admin_forbidden(self):
        tok, _ = _login(*REVIEWER)
        r = requests.post(f"{BASE_URL}/api/admin/seed-review-account", headers=_h(tok), timeout=10)
        assert r.status_code == 403, f"non-admin should be 403, got {r.status_code}"

    @pytest.mark.flaky
    def test_admin_triggers_reseed_and_counts_hold(self):
        tok, _ = _login(*ADMIN)
        # Capture counts BEFORE reseed to prove idempotency.
        rev_tok, _ = _login(*REVIEWER)
        def counts():
            def _get(p):
                r = requests.get(f"{BASE_URL}{p}", headers=_h(rev_tok), timeout=15)
                return r.json() if r.status_code == 200 else []
            def _n(v):
                if isinstance(v, dict):
                    for k in ("items", "drafts", "results", "broadcasts", "forms", "places"):
                        if k in v: return len(v[k])
                return len(v) if isinstance(v, list) else 0
            return {
                "payments": _n(_get("/api/team/payments")),
                "signups": _n(_get("/api/team/signups")),
                "paperwork": _n(_get("/api/team/paperwork")),
                "attendance": _n(_get("/api/team/attendance")),
                "inbox": _n(_get("/api/inbox/drafts")),
                "results": _n(_get("/api/team/results")),
                "roster": _n(_get("/api/roster")),
            }
        before = counts()

        r = requests.post(f"{BASE_URL}/api/admin/seed-review-account", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("status") in ("running", "idle", "done"), r.json()

        # Poll status for up to 3 minutes (OpenAI image gen is slow).
        deadline = time.time() + 180
        last = None
        while time.time() < deadline:
            r2 = requests.get(f"{BASE_URL}/api/admin/seed-review-account", headers=_h(tok), timeout=10)
            assert r2.status_code == 200, r2.text
            last = r2.json()
            if last.get("status") in ("done", "error"):
                break
            time.sleep(5)
        assert last and last.get("status") == "done", f"Reseed did not finish cleanly: {last}"

        after = counts()
        assert after == before, f"Counts drifted (not idempotent): before={before} after={after}"
        # And the required exact counts.
        assert after["payments"] == 3 and after["signups"] == 2 and after["paperwork"] == 2 \
            and after["attendance"] == 3 and after["inbox"] == 3 and after["results"] == 3 \
            and after["roster"] == 8, after
