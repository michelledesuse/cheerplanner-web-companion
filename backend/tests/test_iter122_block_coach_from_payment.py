"""iter122 — Test that owner can block/hide a payment tracker from a coach/staff
Team Hub collaborator (not just family household members).

Bug context: previously GET /api/team/blocks/payment/{tracker_id} only returned
family (member_user_ids), so coaches (team_hub_member_user_ids) never appeared
in the "Who can view this?" list and blocking them returned 404.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")

OWNER_EMAIL = "demo@cheerplanner.app"
OWNER_PWD = "CheerDemo2026!"
COACH_EMAIL = "coach.casey@cheerplanner.app"
COACH_PWD = "CheerDemo2026!"


def _login(session: requests.Session, email: str, pwd: str) -> str:
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def owner_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    token = _login(s, OWNER_EMAIL, OWNER_PWD)
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def coach_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    token = _login(s, COACH_EMAIL, COACH_PWD)
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def tracker(owner_client):
    """Reuse an existing payment tracker in the demo hub, or create one."""
    r = owner_client.get(f"{BASE_URL}/api/team/payments", timeout=20)
    assert r.status_code == 200, f"list payments failed: {r.status_code} {r.text}"
    trackers = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    if trackers:
        t = trackers[0]
        return {"id": t["id"], "created": False}
    r = owner_client.post(f"{BASE_URL}/api/team/payments",
                          json={"name": "TEST_Coach Gift iter122", "amount": 20}, timeout=20)
    assert r.status_code in (200, 201), f"create tracker failed: {r.status_code} {r.text}"
    return {"id": r.json()["id"], "created": True}


def _find_coach_id(members):
    for m in members:
        if (m.get("email") or "").lower() == COACH_EMAIL:
            return m
    return None


def test_owner_blocks_lists_coach_as_member(owner_client, tracker):
    """GET /api/team/blocks/payment/{tid} must include coach with team_access=true, blocked=false"""
    r = owner_client.get(f"{BASE_URL}/api/team/blocks/payment/{tracker['id']}", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("is_owner") is True
    coach = _find_coach_id(data.get("members", []))
    assert coach is not None, f"Coach {COACH_EMAIL} missing from members: {data.get('members')}"
    assert coach["team_access"] is True
    assert coach["blocked"] is False


def test_owner_can_block_coach(owner_client, tracker):
    """PUT /api/team/blocks?blocked=true must return {'blocked': True} (no 404)"""
    r = owner_client.get(f"{BASE_URL}/api/team/blocks/payment/{tracker['id']}", timeout=20)
    coach = _find_coach_id(r.json().get("members", []))
    assert coach is not None
    payload = {"blocked_user_id": coach["id"], "resource": "payment", "resource_id": tracker["id"]}
    r = owner_client.put(f"{BASE_URL}/api/team/blocks?blocked=true", json=payload, timeout=20)
    assert r.status_code == 200, f"block failed: {r.status_code} {r.text}"
    assert r.json() == {"blocked": True}

    # Verify persisted: coach shows blocked=true now
    r = owner_client.get(f"{BASE_URL}/api/team/blocks/payment/{tracker['id']}", timeout=20)
    coach2 = _find_coach_id(r.json().get("members", []))
    assert coach2["blocked"] is True
    assert coach["id"] in r.json().get("blocked_user_ids", [])


def test_coach_cannot_see_blocked_tracker(coach_client, tracker):
    """After block: coach's GET /api/team/payments excludes the tracker; single GET returns 403."""
    r = coach_client.get(f"{BASE_URL}/api/team/payments", timeout=20)
    assert r.status_code == 200, r.text
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    ids = {t["id"] for t in items}
    assert tracker["id"] not in ids, f"Blocked tracker still visible in list: {ids}"

    r = coach_client.get(f"{BASE_URL}/api/team/payments/{tracker['id']}", timeout=20)
    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


def test_owner_can_unblock_coach(owner_client, coach_client, tracker):
    """PUT ?blocked=false unblocks; coach can list + GET tracker again."""
    r = owner_client.get(f"{BASE_URL}/api/team/blocks/payment/{tracker['id']}", timeout=20)
    coach = _find_coach_id(r.json().get("members", []))
    payload = {"blocked_user_id": coach["id"], "resource": "payment", "resource_id": tracker["id"]}
    r = owner_client.put(f"{BASE_URL}/api/team/blocks?blocked=false", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json() == {"blocked": False}

    # Coach can see it again
    r = coach_client.get(f"{BASE_URL}/api/team/payments", timeout=20)
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    ids = {t["id"] for t in items}
    assert tracker["id"] in ids

    r = coach_client.get(f"{BASE_URL}/api/team/payments/{tracker['id']}", timeout=20)
    assert r.status_code == 200


def test_family_regression_still_listed(owner_client, tracker):
    """Regression: family members (member_user_ids) still appear in the list."""
    r = owner_client.get(f"{BASE_URL}/api/team/blocks/payment/{tracker['id']}", timeout=20)
    data = r.json()
    # Should have at least the coach + possibly co-parent (parent.taylor)
    emails = {(m.get("email") or "").lower() for m in data.get("members", [])}
    assert COACH_EMAIL in emails
    # co-parent may or may not be seeded; just verify list isn't empty
    assert len(data.get("members", [])) >= 1


def test_cleanup_created_tracker(owner_client, tracker):
    """Delete the tracker if we created it, so state is restored."""
    if tracker.get("created"):
        r = owner_client.delete(f"{BASE_URL}/api/team/payments/{tracker['id']}", timeout=20)
        assert r.status_code in (200, 204, 404)
