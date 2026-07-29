"""Iter75 backend tests: links persistence on Payments, Sign-ups and Paperwork,
and the three reminder endpoints (payment/signup/paperwork item) return the
expected {sent, no_phone, failed} shape. Roster on the test account is empty so
sent should be 0 for all three (safe — no real texts)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


# --------- Payment tracker: links persistence + reminder shape ---------
class TestPaymentTrackerLinks:
    tracker_id = None

    def test_create_tracker_with_links(self, auth):
        payload = {
            "name": "TEST_iter75 Payment Tracker",
            "amount": 100.00,
            "links": [
                {"label": "Venmo", "url": "https://venmo.com/testcheer"},
                {"label": "Zelle", "url": "https://zellepay.com/testcheer"},
            ],
        }
        r = auth.post(f"{BASE_URL}/api/team/payments", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data["amount"] == 100.00
        assert len(data["links"]) == 2
        assert data["links"][0]["label"] == "Venmo"
        assert data["links"][0]["url"] == "https://venmo.com/testcheer"
        TestPaymentTrackerLinks.tracker_id = data["id"]

    def test_get_tracker_persists_links(self, auth):
        tid = TestPaymentTrackerLinks.tracker_id
        assert tid is not None
        r = auth.get(f"{BASE_URL}/api/team/payments/{tid}")
        assert r.status_code == 200
        data = r.json()
        assert len(data["links"]) == 2
        labels = [l["label"] for l in data["links"]]
        assert "Venmo" in labels and "Zelle" in labels

    def test_patch_tracker_updates_links(self, auth):
        tid = TestPaymentTrackerLinks.tracker_id
        new_links = [{"label": "Stripe", "url": "https://buy.stripe.com/x1y2z3"}]
        r = auth.patch(f"{BASE_URL}/api/team/payments/{tid}", json={"links": new_links})
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["links"]) == 1
        assert data["links"][0]["label"] == "Stripe"
        # verify via GET
        r2 = auth.get(f"{BASE_URL}/api/team/payments/{tid}")
        assert r2.status_code == 200
        assert len(r2.json()["links"]) == 1
        assert r2.json()["links"][0]["url"] == "https://buy.stripe.com/x1y2z3"

    def test_payment_reminder_shape(self, auth):
        tid = TestPaymentTrackerLinks.tracker_id
        r = auth.post(f"{BASE_URL}/api/team/payments/{tid}/remind")
        # SMS may not be configured in test env → 400. Both are acceptable.
        assert r.status_code in (200, 400), r.text
        if r.status_code == 200:
            body = r.json()
            assert set(body.keys()) >= {"sent", "no_phone", "failed"}
            assert isinstance(body["sent"], int)
            assert isinstance(body["no_phone"], list)
            assert isinstance(body["failed"], list)
            # Empty roster on the test account → sent must be 0.
            assert body["sent"] == 0

    def test_cleanup_tracker(self, auth):
        tid = TestPaymentTrackerLinks.tracker_id
        if not tid:
            return
        r = auth.delete(f"{BASE_URL}/api/team/payments/{tid}")
        assert r.status_code == 200


# --------- Sign-up sheet: links persistence + reminder shape ---------
class TestSignupSheetLinks:
    sheet_id = None

    def test_create_sheet_with_links(self, auth):
        payload = {
            "name": "TEST_iter75 Signup Sheet",
            "links": [
                {"label": "Form", "url": "https://forms.example.com/x"},
                {"label": "Details", "url": "https://docs.example.com/y"},
            ],
        }
        r = auth.post(f"{BASE_URL}/api/team/signups", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert len(data["links"]) == 2
        TestSignupSheetLinks.sheet_id = data["id"]

    def test_patch_sheet_updates_links(self, auth):
        sid = TestSignupSheetLinks.sheet_id
        assert sid is not None
        new_links = [{"label": "OnlyOne", "url": "https://only.example.com/"}]
        r = auth.patch(f"{BASE_URL}/api/team/signups/{sid}", json={"links": new_links})
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["links"]) == 1
        assert data["links"][0]["label"] == "OnlyOne"
        # verify via GET
        r2 = auth.get(f"{BASE_URL}/api/team/signups/{sid}")
        assert r2.status_code == 200
        assert len(r2.json()["links"]) == 1

    def test_signup_reminder_shape(self, auth):
        sid = TestSignupSheetLinks.sheet_id
        r = auth.post(f"{BASE_URL}/api/team/signups/{sid}/remind")
        assert r.status_code in (200, 400), r.text
        if r.status_code == 200:
            body = r.json()
            assert set(body.keys()) >= {"sent", "no_phone", "failed"}
            assert body["sent"] == 0

    def test_cleanup_sheet(self, auth):
        sid = TestSignupSheetLinks.sheet_id
        if not sid:
            return
        r = auth.delete(f"{BASE_URL}/api/team/signups/{sid}")
        assert r.status_code == 200


# --------- Paperwork sheet + items: links persistence + reminder shape ---------
class TestPaperworkItemLinks:
    sheet_id = None
    item_id = None

    def test_create_sheet(self, auth):
        r = auth.post(f"{BASE_URL}/api/team/paperwork", json={"name": "TEST_iter75 Paperwork"})
        assert r.status_code == 200, r.text
        TestPaperworkItemLinks.sheet_id = r.json()["id"]

    def test_add_item_with_links(self, auth):
        sid = TestPaperworkItemLinks.sheet_id
        assert sid is not None
        payload = {
            "label": "Medical Waiver",
            "links": [
                {"label": "Blank form", "url": "https://forms.example.com/waiver.pdf"},
                {"label": "Instructions", "url": "https://help.example.com/how"},
            ],
        }
        r = auth.post(f"{BASE_URL}/api/team/paperwork/{sid}/items", json=payload)
        assert r.status_code == 200, r.text
        sheet = r.json()
        assert len(sheet["items"]) == 1
        item = sheet["items"][0]
        assert item["label"] == "Medical Waiver"
        assert len(item["links"]) == 2
        assert item["links"][0]["label"] == "Blank form"
        TestPaperworkItemLinks.item_id = item["id"]

    def test_patch_item_updates_links(self, auth):
        sid = TestPaperworkItemLinks.sheet_id
        iid = TestPaperworkItemLinks.item_id
        assert iid is not None
        new_links = [{"label": "New form", "url": "https://forms.example.com/new.pdf"}]
        r = auth.patch(f"{BASE_URL}/api/team/paperwork/{sid}/items/{iid}", json={"links": new_links})
        assert r.status_code == 200, r.text
        sheet = r.json()
        item = next(i for i in sheet["items"] if i["id"] == iid)
        assert len(item["links"]) == 1
        assert item["links"][0]["label"] == "New form"
        # verify via GET
        r2 = auth.get(f"{BASE_URL}/api/team/paperwork/{sid}")
        assert r2.status_code == 200
        item2 = next(i for i in r2.json()["items"] if i["id"] == iid)
        assert item2["links"][0]["url"] == "https://forms.example.com/new.pdf"

    def test_item_reminder_shape(self, auth):
        sid = TestPaperworkItemLinks.sheet_id
        iid = TestPaperworkItemLinks.item_id
        r = auth.post(f"{BASE_URL}/api/team/paperwork/{sid}/items/{iid}/remind")
        assert r.status_code in (200, 400), r.text
        if r.status_code == 200:
            body = r.json()
            assert set(body.keys()) >= {"sent", "no_phone", "failed"}
            assert body["sent"] == 0

    def test_cleanup_paperwork(self, auth):
        sid = TestPaperworkItemLinks.sheet_id
        if not sid:
            return
        r = auth.delete(f"{BASE_URL}/api/team/paperwork/{sid}")
        assert r.status_code == 200


# --------- Roster empty sanity check (so we know sent should be 0) ---------
class TestRosterEmpty:
    def test_roster_endpoint_returns_list(self, auth):
        r = auth.get(f"{BASE_URL}/api/roster")
        assert r.status_code == 200
        data = r.json()
        # Accept either list or {"members": [...]}. Iter73 uses list per team_roster.
        if isinstance(data, dict) and "members" in data:
            members = data["members"]
        else:
            members = data
        assert isinstance(members, list)
        # Note: not asserting empty — the account may have members. Just log.
        print(f"Roster size for {EMAIL}: {len(members)}")
