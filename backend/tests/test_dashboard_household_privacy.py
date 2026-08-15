"""Repro + fix verification: non-owner member dashboard finances must be
household-scoped and must repopulate after privacy re-enable."""
import os, uuid, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_member_dashboard_household_scoped_and_repopulates():
    tag = uuid.uuid4().hex[:8]
    owner_tok, owner_id = _signup(f"owner_{tag}@t.com")
    m1_tok, m1_id = _signup(f"member_{tag}@t.com")

    # Owner creates an athlete + a $500 expense.
    a = requests.post(f"{BASE}/athletes", json={"name": "Ava", "role": "athlete"}, headers=_h(owner_tok))
    assert a.status_code == 200, a.text
    aid = a.json()["id"]
    e = requests.post(f"{BASE}/expenses", json={"athlete_id": aid, "category": "Gear", "amount": 500, "incurred_on": "2026-08-01"}, headers=_h(owner_tok))
    assert e.status_code == 200, e.text

    # Member joins the owner's household.
    inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(owner_tok)).json()
    j = requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(m1_tok))
    assert j.status_code == 200, j.text

    # 1) Member dashboard now sees the SHARED household expense (was 0 before fix).
    d = requests.get(f"{BASE}/dashboard", headers=_h(m1_tok)).json()
    assert d["can_view_expenses"] is True
    assert d["total_expenses_ytd"] == 500.0, d
    assert d["outstanding_balance"] == 500.0, d

    # 2) Owner hides expenses from member -> zeroed.
    p = requests.patch(f"{BASE}/household/privacy/{m1_id}", json={"expenses": False}, headers=_h(owner_tok))
    assert p.status_code == 200, p.text
    d = requests.get(f"{BASE}/dashboard", headers=_h(m1_tok)).json()
    assert d["can_view_expenses"] is False
    assert d["total_expenses_ytd"] == 0.0, d

    # 3) Owner re-enables -> finances MUST come back (the reported bug).
    p = requests.patch(f"{BASE}/household/privacy/{m1_id}", json={"expenses": True}, headers=_h(owner_tok))
    assert p.status_code == 200, p.text
    d = requests.get(f"{BASE}/dashboard", headers=_h(m1_tok)).json()
    assert d["can_view_expenses"] is True
    assert d["total_expenses_ytd"] == 500.0, d
    assert d["outstanding_balance"] == 500.0, d
    print("PASS: household-scoped dashboard repopulates after re-enable")
