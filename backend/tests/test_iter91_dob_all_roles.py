"""Iteration 91: DOB persistence for all roster roles (athlete + staff/coach/etc.)
and role-aware DOB rendering in public share HTML.
"""
import os
import pytest
import requests
from pathlib import Path

def _load_base():
    for k in ("EXPO_PUBLIC_BACKEND_URL", "EXPO_BACKEND_URL"):
        v = os.environ.get(k)
        if v:
            return v.rstrip("/")
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set")

BASE_URL = _load_base()
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"no token in login resp: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---------- Roster DOB CRUD (non-athlete roles) ----------
class TestRosterDobStaff:
    created_id = None

    def test_create_staff_with_dob(self, api):
        payload = {
            "first_name": "TEST_Staff",
            "last_name": "DobPersist",
            "role": "staff",
            "dob": "05/12",
        }
        r = api.post(f"{BASE_URL}/api/roster", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "staff"
        assert data["dob"] == "05/12", f"POST did not persist dob: {data}"
        TestRosterDobStaff.created_id = data["id"]

    def test_get_staff_dob_persisted(self, api):
        assert TestRosterDobStaff.created_id
        r = api.get(f"{BASE_URL}/api/roster", timeout=15)
        assert r.status_code == 200
        m = next((x for x in r.json() if x["id"] == TestRosterDobStaff.created_id), None)
        assert m is not None
        assert m["dob"] == "05/12", f"GET did not return dob: {m}"

    def test_patch_staff_dob_no_wipe(self, api):
        assert TestRosterDobStaff.created_id
        # Update unrelated field (phone) and ensure dob stays
        r = api.patch(
            f"{BASE_URL}/api/roster/{TestRosterDobStaff.created_id}",
            json={"phone": "5551234567"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["dob"] == "05/12", f"PATCH wiped dob: {r.json()}"

    def test_patch_staff_dob_change(self, api):
        r = api.patch(
            f"{BASE_URL}/api/roster/{TestRosterDobStaff.created_id}",
            json={"dob": "07/04"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["dob"] == "07/04"
        # Confirm via GET
        rg = api.get(f"{BASE_URL}/api/roster", timeout=15)
        m = next((x for x in rg.json() if x["id"] == TestRosterDobStaff.created_id), None)
        assert m["dob"] == "07/04"

    def test_cleanup_delete(self, api):
        if TestRosterDobStaff.created_id:
            r = api.delete(f"{BASE_URL}/api/roster/{TestRosterDobStaff.created_id}", timeout=15)
            assert r.status_code in (200, 204)


# ---------- Roster DOB for athlete (full MM/DD/YYYY) ----------
class TestRosterDobAthlete:
    created_id = None

    def test_create_athlete_with_full_dob(self, api):
        r = api.post(
            f"{BASE_URL}/api/roster",
            json={"first_name": "TEST_Athlete", "last_name": "DobPersist", "role": "athlete", "dob": "05/12/2010"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "athlete"
        assert d["dob"] == "05/12/2010"
        TestRosterDobAthlete.created_id = d["id"]

    def test_cleanup(self, api):
        if TestRosterDobAthlete.created_id:
            api.delete(f"{BASE_URL}/api/roster/{TestRosterDobAthlete.created_id}", timeout=15)


# ---------- Public share HTML has role-aware DOB + onRoleChange ----------
class TestPublicShareDobRoleAware:
    token = None
    member_id = None

    def test_create_member_and_share_link(self, api):
        # create a staff member (non-athlete) to test dob for that role
        r = api.post(
            f"{BASE_URL}/api/roster",
            json={"first_name": "TEST_Share", "last_name": "Staff", "role": "staff"},
            timeout=15,
        )
        assert r.status_code == 200
        TestPublicShareDobRoleAware.member_id = r.json()["id"]
        # create share link
        r2 = api.post(
            f"{BASE_URL}/api/team/share",
            json={"kind": "roster_member", "ref_id": TestPublicShareDobRoleAware.member_id},
            timeout=15,
        )
        # may fail with 402 if premium gating blocks — accept, or pass without token
        if r2.status_code == 402:
            pytest.skip("parent_share_links premium-gated for this account")
        assert r2.status_code == 200, r2.text
        TestPublicShareDobRoleAware.token = r2.json()["token"]

    def test_public_page_dob_input_and_onrolechange(self, api):
        if not TestPublicShareDobRoleAware.token:
            pytest.skip("no share token")
        r = requests.get(f"{BASE_URL}/api/public/s/{TestPublicShareDobRoleAware.token}", timeout=15)
        assert r.status_code == 200
        html = r.text
        assert "id='dob'" in html or 'id="dob"' in html, "DOB input missing in public page"
        assert "onRoleChange()" in html, "onRoleChange handler missing"
        assert "dobLabel" in html, "dobLabel element missing"
        assert "Birthday (month / day)" in html, "Non-athlete label text missing"
        assert "Date of birth" in html, "Athlete label text missing"

    def test_public_submit_staff_dob_saves(self, api):
        if not TestPublicShareDobRoleAware.token or not TestPublicShareDobRoleAware.member_id:
            pytest.skip("no token/member")
        payload = {
            "first_name": "TEST_Share",
            "last_name": "Staff",
            "role": "staff",
            "dob": "09/23",
        }
        r = requests.post(
            f"{BASE_URL}/api/public/share/{TestPublicShareDobRoleAware.token}/submit",
            json=payload,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Confirm dob saved on roster member (authed GET)
        rg = api.get(f"{BASE_URL}/api/roster", timeout=15)
        m = next((x for x in rg.json() if x["id"] == TestPublicShareDobRoleAware.member_id), None)
        assert m is not None
        assert m["dob"] == "09/23", f"public submit did not save dob for staff: {m}"
        assert m["role"] == "staff"

    def test_cleanup(self, api):
        if TestPublicShareDobRoleAware.member_id:
            api.delete(f"{BASE_URL}/api/roster/{TestPublicShareDobRoleAware.member_id}", timeout=15)
