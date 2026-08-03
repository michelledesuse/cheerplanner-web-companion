"""Iter77 backend tests:
1) Public roster share link accepts a photo and persists it on the roster member.
2) Season filtering for expenses / payments / fundraisers via ?season_id=.
3) Fundraiser POST without photos/season_ids works (regression).
4) Bulk expenses/payments accept optional season_ids.
"""
import os
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"

# 1x1 red pixel PNG
_PIXEL = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000d49444154789c63f8cf00000003000100dfc7b8620000000049454e44ae426082"
    )
).decode()
PHOTO_DATA_URL = f"data:image/png;base64,{_PIXEL}"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"] if "access_token" in r.json() else r.json()["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def two_seasons(h):
    """Create 2 TEST_* seasons for filtering tests; clean up at end."""
    created = []
    for label in ("TEST_ITER77_A", "TEST_ITER77_B"):
        r = requests.post(f"{BASE_URL}/api/seasons", json={"name": label}, headers=h, timeout=30)
        assert r.status_code in (200, 201), f"season create failed: {r.status_code} {r.text}"
        created.append(r.json())
    # Activate the first one so create-endpoints auto-tag with it (only if implementation reads active season).
    requests.post(f"{BASE_URL}/api/seasons/{created[0]['id']}/activate", headers=h, timeout=30)
    yield created
    for s in created:
        try:
            requests.delete(f"{BASE_URL}/api/seasons/{s['id']}", headers=h, timeout=15)
        except Exception:
            pass


# =====================================================================
# 1) Roster share link + photo upload
# =====================================================================
class TestRosterSharePhoto:
    def test_create_and_submit_with_photo(self, h):
        r = requests.post(f"{BASE_URL}/api/team/share", json={"kind": "roster"}, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        tok = r.json()["token"]

        # Public data endpoint (no auth)
        r = requests.get(f"{BASE_URL}/api/public/share/{tok}/data", timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("kind") == "roster"

        unique = uuid.uuid4().hex[:8]
        first = "TEST77"
        last = f"Photo{unique}"
        payload = {
            "first_name": first,
            "last_name": last,
            "role": "athlete",
            "photo": PHOTO_DATA_URL,
        }
        r = requests.post(f"{BASE_URL}/api/public/share/{tok}/submit", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify via authed GET /api/roster that the member has the photo set
        r = requests.get(f"{BASE_URL}/api/roster", headers=h, timeout=30)
        assert r.status_code == 200
        members = r.json()
        me = next((m for m in members if (m.get("last_name") or "") == last and (m.get("first_name") or "") == first), None)
        assert me is not None, f"submitted member not found: {last}"
        assert me.get("photo"), "photo not persisted on roster member"
        assert me["photo"].startswith("data:image/"), "photo isn't a data URL"

        # cleanup
        requests.delete(f"{BASE_URL}/api/roster/{me['id']}", headers=h, timeout=15)


# =====================================================================
# 2) Season filter: Expenses
# =====================================================================
class TestExpenseSeasonFilter:
    def test_tagged_expense_visible_only_under_its_season(self, h, two_seasons):
        s_a, s_b = two_seasons[0]["id"], two_seasons[1]["id"]
        note_marker = f"TEST_ITER77_EXP_{uuid.uuid4().hex[:6]}"
        # Need an athlete to attach the expense to
        ar = requests.get(f"{BASE_URL}/api/athletes", headers=h, timeout=30)
        assert ar.status_code == 200 and ar.json(), "no athletes"
        aid = ar.json()[0]["id"]
        r = requests.post(
            f"{BASE_URL}/api/expenses",
            json={
                "athlete_id": aid,
                "category": "Other",
                "amount": 10.0,
                "note": note_marker,
                "incurred_on": "2026-01-15",
                "season_ids": [s_a],
            },
            headers=h,
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        created = r.json()
        assert isinstance(created, list) and len(created) == 1
        eid = created[0]["id"]
        assert s_a in (created[0].get("season_ids") or []), created[0]

        try:
            # Under season A: should be visible
            r = requests.get(f"{BASE_URL}/api/expenses?season_id={s_a}", headers=h, timeout=30)
            assert r.status_code == 200
            assert any(e["id"] == eid for e in r.json()), "tagged expense missing from its own season"

            # Under season B: should NOT be visible
            r = requests.get(f"{BASE_URL}/api/expenses?season_id={s_b}", headers=h, timeout=30)
            assert r.status_code == 200
            assert not any(e["id"] == eid for e in r.json()), "tagged expense leaked into other season"
        finally:
            requests.delete(f"{BASE_URL}/api/expenses/{eid}", headers=h, timeout=15)

    def test_untagged_expense_visible_across_seasons(self, h, two_seasons):
        s_a, s_b = two_seasons[0]["id"], two_seasons[1]["id"]
        note = f"TEST_ITER77_UNTAG_{uuid.uuid4().hex[:6]}"
        ar = requests.get(f"{BASE_URL}/api/athletes", headers=h, timeout=30)
        aid = ar.json()[0]["id"]
        # Create WITHOUT season_ids and then strip season_ids if auto-tagged.
        r = requests.post(
            f"{BASE_URL}/api/expenses",
            json={"athlete_id": aid, "category": "Other", "amount": 5.0, "note": note, "incurred_on": "2026-01-15"},
            headers=h,
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        eid = r.json()[0]["id"]
        # Force to legacy/untagged state
        requests.patch(f"{BASE_URL}/api/expenses/{eid}", json={"season_ids": []}, headers=h, timeout=30)
        try:
            for sid in (s_a, s_b):
                r = requests.get(f"{BASE_URL}/api/expenses?season_id={sid}", headers=h, timeout=30)
                assert r.status_code == 200
                assert any(e["id"] == eid for e in r.json()), f"untagged expense not shown under {sid}"
        finally:
            requests.delete(f"{BASE_URL}/api/expenses/{eid}", headers=h, timeout=15)


# =====================================================================
# 3) Season filter: Payments
# =====================================================================
class TestPaymentSeasonFilter:
    def test_payment_season_visibility(self, h, two_seasons):
        s_a, s_b = two_seasons[0]["id"], two_seasons[1]["id"]

        # need an athlete
        r = requests.get(f"{BASE_URL}/api/athletes", headers=h, timeout=30)
        assert r.status_code == 200 and r.json(), "no athletes to attach payment to"
        aid = r.json()[0]["id"]

        r = requests.post(
            f"{BASE_URL}/api/payments",
            json={"athlete_id": aid, "amount": 5.0, "paid_on": "2026-01-15", "season_ids": [s_a]},
            headers=h,
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        try:
            r = requests.get(f"{BASE_URL}/api/payments?season_id={s_a}", headers=h, timeout=30)
            assert any(p["id"] == pid for p in r.json())
            r = requests.get(f"{BASE_URL}/api/payments?season_id={s_b}", headers=h, timeout=30)
            assert not any(p["id"] == pid for p in r.json())
        finally:
            requests.delete(f"{BASE_URL}/api/payments/{pid}", headers=h, timeout=15)


# =====================================================================
# 4) Season filter: Fundraisers + no-photos regression
# =====================================================================
class TestFundraiserSeasonAndRegression:
    def test_fundraiser_season_visibility(self, h, two_seasons):
        s_a, s_b = two_seasons[0]["id"], two_seasons[1]["id"]
        name = f"TEST_ITER77_FR_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/fundraisers",
            json={"name": name, "amount_raised": 20.0, "raised_on": "2026-01-15", "season_ids": [s_a]},
            headers=h,
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        fid = r.json()["id"]
        try:
            r = requests.get(f"{BASE_URL}/api/fundraisers?season_id={s_a}", headers=h, timeout=30)
            assert any(f["id"] == fid for f in r.json())
            r = requests.get(f"{BASE_URL}/api/fundraisers?season_id={s_b}", headers=h, timeout=30)
            assert not any(f["id"] == fid for f in r.json())
        finally:
            requests.delete(f"{BASE_URL}/api/fundraisers/{fid}", headers=h, timeout=15)

    def test_fundraiser_no_photos_no_seasons(self, h):
        name = f"TEST_ITER77_FR_NOPH_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/fundraisers",
            json={"name": name, "amount_raised": 1.0, "raised_on": "2026-01-15"},
            headers=h,
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["name"] == name
        requests.delete(f"{BASE_URL}/api/fundraisers/{body['id']}", headers=h, timeout=15)


# =====================================================================
# 5) Bulk expense/payment accept season_ids
# =====================================================================
class TestBulkSeasonTagging:
    def test_expense_bulk_tags_all_rows(self, h, two_seasons):
        s_a = two_seasons[0]["id"]
        r = requests.get(f"{BASE_URL}/api/athletes", headers=h, timeout=30)
        assert r.status_code == 200 and r.json()
        athlete_ids = [a["id"] for a in r.json()[:2]] or [r.json()[0]["id"]]

        r = requests.post(
            f"{BASE_URL}/api/expenses/bulk",
            json={
                "athlete_ids": athlete_ids,
                "category": "Other",
                "amount": 8.0,
                "note": f"TEST_ITER77_BULK_EXP_{uuid.uuid4().hex[:6]}",
                "incurred_on": "2026-01-15",
                "split_mode": "same",
                "season_ids": [s_a],
            },
            headers=h,
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        created = r.json()
        assert isinstance(created, list) and created
        for row in created:
            assert s_a in (row.get("season_ids") or []), f"bulk expense missing season tag: {row}"
        for row in created:
            requests.delete(f"{BASE_URL}/api/expenses/{row['id']}", headers=h, timeout=15)

    def test_payment_bulk_tags_all_rows(self, h, two_seasons):
        s_a = two_seasons[0]["id"]
        r = requests.get(f"{BASE_URL}/api/athletes", headers=h, timeout=30)
        athlete_ids = [a["id"] for a in r.json()[:2]] or [r.json()[0]["id"]]

        r = requests.post(
            f"{BASE_URL}/api/payments/bulk",
            json={
                "athlete_ids": athlete_ids,
                "amount": 3.0,
                "paid_on": "2026-01-15",
                "split_mode": "same",
                "season_ids": [s_a],
            },
            headers=h,
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        created = r.json()
        assert isinstance(created, list) and created
        for row in created:
            assert s_a in (row.get("season_ids") or []), f"bulk payment missing season tag: {row}"
        for row in created:
            requests.delete(f"{BASE_URL}/api/payments/{row['id']}", headers=h, timeout=15)
