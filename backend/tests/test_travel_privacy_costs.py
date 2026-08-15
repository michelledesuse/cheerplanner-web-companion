"""Travel visibility: member can VIEW booking logistics but not costs when their
'expenses' visibility is off; flights still populate the calendar; toggling travel
back on repopulates bookings."""
import os, uuid, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001") + "/api"


def _signup(email):
    r = requests.post(f"{BASE}/auth/signup", json={"email": email, "password": "Pass2026!", "name": email.split("@")[0]})
    assert r.status_code == 200, (r.status_code, r.text)
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_travel_costs_hidden_but_logistics_visible():
    tag = uuid.uuid4().hex[:8]
    owner_tok, owner_id = _signup(f"o_{tag}@t.com")
    m_tok, m_id = _signup(f"m_{tag}@t.com")

    # Owner creates a competition + a flight booking with costs.
    c = requests.post(f"{BASE}/competitions", json={"name": "Summit", "event_date": "2026-09-10", "location": "Orlando, FL"}, headers=_h(owner_tok))
    assert c.status_code == 200, c.text
    cid = c.json()["id"]
    b = requests.post(f"{BASE}/bookings", json={
        "competition_id": cid, "type": "flight", "provider": "Delta",
        "confirmation": "ABC123", "flight_number": "DL100",
        "depart_airport": "DFW", "arrive_airport": "MCO",
        "depart_time": "2026-09-09T08:00", "arrive_time": "2026-09-09T11:00",
        "outbound_cost": 300, "cost": 300, "amount_paid": 100, "balance_due_date": "2026-08-20",
    }, headers=_h(owner_tok))
    assert b.status_code == 200, b.text

    # Member joins household.
    inv = requests.post(f"{BASE}/household/invite", json={}, headers=_h(owner_tok)).json()
    requests.post(f"{BASE}/household/join", json={"code": inv["code"]}, headers=_h(m_tok))

    # Kids preset: expenses OFF, travel ON.
    requests.patch(f"{BASE}/household/privacy/{m_id}", json={"expenses": False, "travel": True}, headers=_h(owner_tok))

    # Member CAN view booking logistics but NOT the costs.
    r = requests.get(f"{BASE}/bookings?competition_id={cid}", headers=_h(m_tok))
    assert r.status_code == 200, r.text
    bk = r.json()[0]
    assert bk["provider"] == "Delta"
    assert bk["flight_number"] == "DL100"
    assert bk["depart_airport"] == "DFW"
    assert bk["cost"] in (None,), bk
    assert bk["amount_paid"] in (None,), bk
    assert bk["outbound_cost"] in (None,), bk
    assert bk["balance_due_date"] in (None,), bk

    # Flight STILL populates the calendar; expense_due items are hidden.
    cal = requests.get(f"{BASE}/calendar?start=2026-09-01&end=2026-09-30", headers=_h(m_tok)).json()["items"]
    kinds = {i["kind"] for i in cal}
    assert "flight_depart" in kinds, kinds

    # Owner turns travel OFF -> member gets 403 + no booking calendar items.
    requests.patch(f"{BASE}/household/privacy/{m_id}", json={"travel": False}, headers=_h(owner_tok))
    assert requests.get(f"{BASE}/bookings?competition_id={cid}", headers=_h(m_tok)).status_code == 403
    cal = requests.get(f"{BASE}/calendar?start=2026-09-01&end=2026-09-30", headers=_h(m_tok)).json()["items"]
    assert "flight_depart" not in {i["kind"] for i in cal}

    # Turn travel back ON -> bookings repopulate (the reported bug).
    requests.patch(f"{BASE}/household/privacy/{m_id}", json={"travel": True}, headers=_h(owner_tok))
    r = requests.get(f"{BASE}/bookings?competition_id={cid}", headers=_h(m_tok))
    assert r.status_code == 200 and len(r.json()) == 1, r.text

    # Owner sees full costs (unchanged).
    ro = requests.get(f"{BASE}/bookings?competition_id={cid}", headers=_h(owner_tok)).json()[0]
    assert ro["cost"] == 300 and ro["amount_paid"] == 100
    print("PASS: travel logistics visible, costs hidden, flights on calendar, repopulates")
