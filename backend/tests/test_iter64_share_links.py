"""Tests for public share links (iter 64) — /api/team/share and /api/public/*."""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    assert r.json()["user"].get("team_access") is True, "review account must have team_access=true"
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def signup_sheet(auth_headers):
    """Create a temporary signup sheet with 1 slot and yield its id; cleanup after."""
    r = requests.post(f"{BASE_URL}/api/team/signups", json={"name": "TEST_share_sheet"}, headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    sheet_id = r.json()["id"]
    # add slot
    r2 = requests.post(f"{BASE_URL}/api/team/signups/{sheet_id}/slots",
                       json={"label": "TEST_Water bottles", "kind": "item", "qty_needed": 3}, headers=auth_headers, timeout=30)
    assert r2.status_code == 200, r2.text
    slot_id = r2.json()["slots"][0]["id"]
    yield {"sheet_id": sheet_id, "slot_id": slot_id}
    # cleanup
    requests.delete(f"{BASE_URL}/api/team/signups/{sheet_id}", headers=auth_headers, timeout=30)


@pytest.fixture(scope="module")
def created_links():
    """Track share link ids for cleanup."""
    ids = []
    yield ids


def test_login_and_team_access(auth_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    assert r.json().get("team_access") is True


def test_create_share_sizes(auth_headers, created_links):
    r = requests.post(f"{BASE_URL}/api/team/share", json={"kind": "sizes"}, headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "token" in d and "id" in d and d["kind"] == "sizes"
    created_links.append(("sizes", d["id"], d["token"]))


def test_create_share_roster(auth_headers, created_links):
    r = requests.post(f"{BASE_URL}/api/team/share", json={"kind": "roster"}, headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "roster"
    created_links.append(("roster", d["id"], d["token"]))


def test_create_share_signup(auth_headers, signup_sheet, created_links):
    r = requests.post(f"{BASE_URL}/api/team/share",
                      json={"kind": "signup", "ref_id": signup_sheet["sheet_id"]}, headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "signup"
    created_links.append(("signup", d["id"], d["token"]))


def test_create_share_idempotent(auth_headers, created_links):
    # sizes idempotency
    tok0 = next(t for k, _, t in created_links if k == "sizes")
    r = requests.post(f"{BASE_URL}/api/team/share", json={"kind": "sizes"}, headers=auth_headers, timeout=30)
    assert r.status_code == 200
    assert r.json()["token"] == tok0, "Same kind+ref should reuse token"


def test_create_share_requires_team_access():
    # Anonymous - should 401 or 403
    r = requests.post(f"{BASE_URL}/api/team/share", json={"kind": "sizes"}, timeout=30)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"


def test_public_data_sizes(created_links):
    tok = next(t for k, _, t in created_links if k == "sizes")
    r = requests.get(f"{BASE_URL}/api/public/share/{tok}/data", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "sizes"
    assert isinstance(d["columns"], list) and len(d["columns"]) > 0
    assert all("id" in c and "label" in c for c in d["columns"])
    assert isinstance(d["members"], list)
    for m in d["members"]:
        assert "id" in m and "name" in m


def test_public_data_roster(created_links):
    tok = next(t for k, _, t in created_links if k == "roster")
    r = requests.get(f"{BASE_URL}/api/public/share/{tok}/data", timeout=30)
    assert r.status_code == 200
    assert r.json()["kind"] == "roster"


def test_public_data_signup(created_links):
    tok = next(t for k, _, t in created_links if k == "signup")
    r = requests.get(f"{BASE_URL}/api/public/share/{tok}/data", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "signup"
    assert isinstance(d["slots"], list) and len(d["slots"]) >= 1
    s0 = d["slots"][0]
    for k in ("id", "label", "kind", "qty_needed", "claimed", "claims"):
        assert k in s0, f"missing {k} in slot"


def test_public_submit_signup_guest_claim(auth_headers, signup_sheet, created_links):
    tok = next(t for k, _, t in created_links if k == "signup")
    r = requests.post(f"{BASE_URL}/api/public/share/{tok}/submit",
                      json={"slot_id": signup_sheet["slot_id"], "name": "TEST_Guest Parent", "qty": 2, "note": "bringing waters"},
                      timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True
    # verify via authed GET
    r2 = requests.get(f"{BASE_URL}/api/team/signups/{signup_sheet['sheet_id']}", headers=auth_headers, timeout=30)
    assert r2.status_code == 200
    slot = next(s for s in r2.json()["slots"] if s["id"] == signup_sheet["slot_id"])
    claim = next((c for c in slot["claims"] if c.get("guest_name") == "TEST_Guest Parent"), None)
    assert claim is not None, f"guest claim not found: {slot['claims']}"
    assert claim["qty"] == 2
    assert claim.get("member_id") is None


def test_public_submit_roster_creates_member(auth_headers, created_links):
    tok = next(t for k, _, t in created_links if k == "roster")
    payload = {"first_name": "TEST_Parent", "last_name": "Zeta_iter64", "role": "parent", "phone": "555-0001"}
    r = requests.post(f"{BASE_URL}/api/public/share/{tok}/submit", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    # verify authed
    r2 = requests.get(f"{BASE_URL}/api/roster", headers=auth_headers, timeout=30)
    assert r2.status_code == 200
    match = next((m for m in r2.json() if m["name"] == "TEST_Parent Zeta_iter64"), None)
    assert match is not None, "roster member was not created"
    assert match.get("phone") == "555-0001"
    # cleanup
    requests.delete(f"{BASE_URL}/api/roster/{match['id']}", headers=auth_headers, timeout=30)


def test_public_submit_sizes_sets_value(auth_headers, created_links):
    tok = next(t for k, _, t in created_links if k == "sizes")
    # get data to obtain a member and column
    d = requests.get(f"{BASE_URL}/api/public/share/{tok}/data", timeout=30).json()
    if not d["members"]:
        pytest.skip("No roster members to submit sizes for")
    mid = d["members"][0]["id"]
    cid = d["columns"][0]["id"]
    prev = None
    r = requests.post(f"{BASE_URL}/api/public/share/{tok}/submit",
                      json={"member_id": mid, "values": {cid: "TEST_XL_iter64"}}, timeout=30)
    assert r.status_code == 200, r.text
    # verify via authed sizes GET
    r2 = requests.get(f"{BASE_URL}/api/team/sizes", headers=auth_headers, timeout=30)
    assert r2.status_code == 200
    values = r2.json().get("values", {})
    assert values.get(mid, {}).get(cid) == "TEST_XL_iter64"
    # cleanup: clear value
    requests.post(f"{BASE_URL}/api/public/share/{tok}/submit",
                  json={"member_id": mid, "values": {cid: ""}}, timeout=30)


def test_public_html_page_ok(created_links):
    tok = next(t for k, _, t in created_links if k == "signup")
    r = requests.get(f"{BASE_URL}/api/public/s/{tok}", timeout=30)
    assert r.status_code == 200
    ct = r.headers.get("content-type", "")
    assert "text/html" in ct, f"content-type: {ct}"
    body = r.text
    assert "<script" in body
    assert "CheerPlanner" in body


def test_public_html_page_invalid_token_404():
    r = requests.get(f"{BASE_URL}/api/public/s/does-not-exist-token", timeout=30)
    assert r.status_code == 404
    assert "text/html" in r.headers.get("content-type", "")
    assert "invalid" in r.text.lower() or "unavailable" in r.text.lower()


def test_public_data_invalid_token_404():
    r = requests.get(f"{BASE_URL}/api/public/share/does-not-exist-token/data", timeout=30)
    assert r.status_code == 404


def test_revoke_share_and_public_returns_404(auth_headers, created_links):
    # Revoke the roster link and verify public endpoints 404
    entry = next((e for e in created_links if e[0] == "roster"), None)
    assert entry is not None
    kind, link_id, tok = entry
    r = requests.delete(f"{BASE_URL}/api/team/share/{link_id}", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("revoked") is True
    r2 = requests.get(f"{BASE_URL}/api/public/share/{tok}/data", timeout=30)
    assert r2.status_code == 404
    r3 = requests.get(f"{BASE_URL}/api/public/s/{tok}", timeout=30)
    assert r3.status_code == 404


def test_cleanup_remaining_links(auth_headers, created_links, signup_sheet):
    # Revoke remaining active links (sizes, signup)
    for kind, link_id, tok in created_links:
        if kind == "roster":
            continue  # already revoked above
        requests.delete(f"{BASE_URL}/api/team/share/{link_id}", headers=auth_headers, timeout=30)
    # Verify team_access still true at end
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=30)
    assert r.json().get("team_access") is True
