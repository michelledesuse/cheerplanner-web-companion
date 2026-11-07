# Flight itinerary (segments + fare breakdown), calendar per-segment items, inbox merge into existing flight card
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
EMAIL, PASSWORD = "demo@cheerplanner.app", "CheerDemo2026!"


def _env(key):
    for line in open("/app/backend/.env"):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        pytest.skip("login failed")
    tok = r.json()["access_token"]
    sess.headers.update({"Authorization": f"Bearer {tok}"})
    sess.user_id = r.json()["user"]["id"]
    return sess


@pytest.fixture(scope="module")
def mdb():
    return MongoClient(_env("MONGO_URL"))[_env("DB_NAME")]


@pytest.fixture(scope="module")
def comp(s):
    r = s.post(f"{BASE_URL}/api/competitions", json={"name": "TEST_FlightComp", "event_date": "2027-03-12",
                                                        "end_date": "2027-03-13", "location": "Atlanta, GA"})
    assert r.status_code in (200, 201), r.text
    c = r.json()
    yield c
    for b in s.get(f"{BASE_URL}/api/bookings", params={"competition_id": c["id"]}).json():
        s.delete(f"{BASE_URL}/api/bookings/{b['id']}")
    s.delete(f"{BASE_URL}/api/competitions/{c['id']}")


SEGS = [
    {"direction": "outbound", "airline": "Delta", "confirmation": "TESTAB", "flight_number": "DL100",
     "depart_airport": "lax", "depart_time": "2027-03-11T08:00", "arrive_airport": "dfw",
     "arrive_time": "2027-03-11T13:00", "passengers": ["Mom", "Ava"]},
    {"direction": "outbound", "airline": "Delta", "confirmation": "TESTAB", "flight_number": "DL200",
     "depart_airport": "dfw", "depart_time": "2027-03-11T14:30", "arrive_airport": "atl",
     "arrive_time": "2027-03-11T17:45", "passengers": ["Mom", "Ava"]},
]
FARE = {"outbound": {"passengers": 2, "base_fare": 200, "taxes_fees": 30, "bag_fees": 70, "seat_fees": 40,
                     "amount_paid": 300, "paid_on": "2026-12-01"}}


def _mk(s, comp, **extra):
    body = {"type": "flight", "competition_id": comp["id"], "provider": "Delta", "segments": SEGS, "fare": FARE}
    body.update(extra)
    r = s.post(f"{BASE_URL}/api/bookings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _get(s, comp, bid):
    return next(b for b in s.get(f"{BASE_URL}/api/bookings", params={"competition_id": comp["id"]}).json() if b["id"] == bid)


class TestFlightBooking:
    def test_create_rollups(self, s, comp):
        b = _mk(s, comp)
        assert b["cost"] == 570 and b["amount_paid"] == 300
        assert b["flight_number"] == "DL100" and b["depart_airport"] == "LAX" and b["arrive_airport"] == "ATL"
        assert b["arrive_time"] == "2027-03-11T17:45"
        assert len(b["segments"]) == 2 and all(x["id"] for x in b["segments"])
        g = _get(s, comp, b["id"])
        assert g["cost"] == 570 and g["fare"]["outbound"]["bag_fees"] == 70
        s.delete(f"{BASE_URL}/api/bookings/{b['id']}")

    def test_patch_add_return_then_remove(self, s, comp):
        b = _mk(s, comp)
        ret = {"direction": "return", "airline": "United", "confirmation": "TESTRT", "flight_number": "UA9",
               "depart_airport": "atl", "depart_time": "2027-03-14T10:00", "arrive_airport": "lax",
               "arrive_time": "2027-03-14T12:30", "passengers": ["Mom"]}
        fare = {**FARE, "return": {"passengers": 1, "base_fare": 150, "taxes_fees": 25, "bag_fees": 35,
                                   "seat_fees": 0, "amount_paid": 210}}
        r = s.patch(f"{BASE_URL}/api/bookings/{b['id']}", json={"segments": b["segments"] + [ret], "fare": fare})
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["cost"] == 570 + 210 and u["amount_paid"] == 510
        assert u["return_flight_number"] == "UA9" and u["return_depart_airport"] == "ATL"
        assert u["return_cost"] == 210 and u["outbound_cost"] == 570
        # remove return
        r = s.patch(f"{BASE_URL}/api/bookings/{b['id']}", json={"segments": b["segments"], "fare": FARE})
        u = r.json()
        assert u["return_flight_number"] is None and u["return_depart_time"] is None
        assert u["cost"] == 570 and u["amount_paid"] == 300
        g = _get(s, comp, b["id"])
        assert len(g["segments"]) == 2
        s.delete(f"{BASE_URL}/api/bookings/{b['id']}")

    def test_patch_remove_all_segments(self, s, comp):
        """Clearing every segment should not leave legacy fields that re-derive segments."""
        b = _mk(s, comp)
        r = s.patch(f"{BASE_URL}/api/bookings/{b['id']}", json={"segments": []})
        assert r.status_code == 200
        g = _get(s, comp, b["id"])
        s.delete(f"{BASE_URL}/api/bookings/{b['id']}")
        assert g["segments"] == [], f"segments re-derived from stale legacy fields: {g['segments']}"

    def test_legacy_flight_segments_derived(self, s, comp, mdb):
        bid = str(uuid.uuid4())
        mdb.bookings.insert_one({"id": bid, "user_id": s.user_id, "competition_id": comp["id"], "type": "flight",
                                 "provider": "TEST_Air", "flight_number": "AA1", "depart_airport": "JFK",
                                 "depart_time": "2027-03-11T09:00", "arrive_airport": "ATL",
                                 "return_flight_number": "AA2", "return_depart_time": "2027-03-14T09:00",
                                 "cost": 400, "amount_paid": 100, "created_at": datetime.now(timezone.utc).isoformat()})
        g = _get(s, comp, bid)
        mdb.bookings.delete_one({"id": bid})
        ids = [x["id"] for x in g["segments"]]
        assert ids == ["out", "ret"]

    def test_calendar_per_segment(self, s, comp):
        b = _mk(s, comp)
        r = s.get(f"{BASE_URL}/api/calendar", params={"start": "2027-03-10", "end": "2027-03-15"})
        assert r.status_code == 200, r.text
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", [])
        mine = [i for i in items if b["id"] in str(i.get("id"))]
        s.delete(f"{BASE_URL}/api/bookings/{b['id']}")
        titles = [i["title"] for i in mine]
        assert "Flight LAX → DFW" in titles and "Flight DFW → ATL" in titles, titles
        assert titles.index("Flight LAX → DFW") < titles.index("Flight DFW → ATL")
        assert all("Passengers: Mom, Ava" in i["subtitle"] for i in mine if i["title"].startswith("Flight"))


class TestInboxMerge:
    def _draft(self, mdb, uid, data):
        did = str(uuid.uuid4())
        mdb.inbox_drafts.insert_one({"id": did, "user_id": uid, "kind": "booking", "source": "paste",
                                     "summary": "TEST_flight draft", "raw_excerpt": "TEST", "data": data,
                                     "status": "pending", "created_at": datetime.now(timezone.utc).isoformat()})
        return did

    def test_dup_check_and_merge(self, s, comp, mdb):
        b = _mk(s, comp)
        data = {"type": "flight", "provider": "Delta", "confirmation": "TESTAB", "flight_number": "DL900",
                "depart_airport": "ATL", "depart_time": "2027-03-14T09:00", "arrive_airport": "LAX",
                "arrive_time": "2027-03-14T11:00", "return_flight_number": None}
        data2 = {"type": "flight", "provider": "Delta", "return_flight_number": "DL900", "return_depart_airport": "ATL",
                 "return_depart_time": "2027-03-14T09:00", "return_arrive_airport": "LAX",
                 "return_arrive_time": "2027-03-14T11:00", "confirmation": "TESTAB", "cost": 500, "amount_paid": 500}
        did = self._draft(mdb, s.user_id, data2)
        r = s.get(f"{BASE_URL}/api/inbox/drafts/{did}/dup-check", params={"competition_id": comp["id"]})
        assert r.status_code == 200, r.text
        dc = r.json()
        assert dc["flights"] and dc["flights"][0]["id"] == b["id"] and dc["flights"][0]["match"] is True
        r = s.post(f"{BASE_URL}/api/inbox/drafts/{did}/confirm",
                   json={"kind": "booking", "booking": {**data2, "competition_id": comp["id"]}, "merge_booking_id": b["id"]})
        assert r.status_code == 200, r.text
        g = _get(s, comp, b["id"])
        allb = s.get(f"{BASE_URL}/api/bookings", params={"competition_id": comp["id"]}).json()
        mdb.inbox_drafts.delete_one({"id": did})
        s.delete(f"{BASE_URL}/api/bookings/{b['id']}")
        assert len([x for x in allb if x["type"] == "flight"]) == 1
        assert g["cost"] == 1070 and g["amount_paid"] == 800
        assert len(g["segments"]) == 3 and g["return_flight_number"] == "DL900"

    def test_merge_same_direction_overrides_stale_breakdown(self, s, comp, mdb):
        """Import with flat cost into a card that has a detailed outbound fare: stale taxes/bags/seats
        from the old breakdown should not be added on top of the imported total."""
        b = _mk(s, comp)
        data = {"type": "flight", "provider": "Delta", "confirmation": "TESTAB", "flight_number": "DL100",
                "depart_airport": "LAX", "depart_time": "2027-03-11T08:00", "cost": 600, "amount_paid": 600}
        did = self._draft(mdb, s.user_id, data)
        r = s.post(f"{BASE_URL}/api/inbox/drafts/{did}/confirm",
                   json={"kind": "booking", "booking": {**data, "competition_id": comp["id"]}, "merge_booking_id": b["id"]})
        g = _get(s, comp, b["id"])
        mdb.inbox_drafts.delete_one({"id": did})
        s.delete(f"{BASE_URL}/api/bookings/{b['id']}")
        assert r.status_code == 200
        print("merged fare:", g["fare"], "cost", g["cost"], "paid", g["amount_paid"])
        assert g["cost"] == 600, f"cost {g['cost']} – fare {g['fare']}"

    def test_merge_wrong_id_404(self, s, comp, mdb):
        data = {"type": "flight", "flight_number": "DL1", "depart_time": "2027-03-11T08:00"}
        did = self._draft(mdb, s.user_id, data)
        r = s.post(f"{BASE_URL}/api/inbox/drafts/{did}/confirm",
                   json={"kind": "booking", "booking": {**data, "competition_id": comp["id"]}, "merge_booking_id": "nope"})
        mdb.inbox_drafts.delete_one({"id": did})
        assert r.status_code == 404

    def test_confirm_all_auto_merge(self, s, comp, mdb):
        b = _mk(s, comp)
        # pause other pending drafts of this user so confirm-all only touches ours
        others = [d["id"] for d in mdb.inbox_drafts.find({"user_id": s.user_id, "status": "pending"}, {"id": 1})]
        mdb.inbox_drafts.update_many({"id": {"$in": others}}, {"$set": {"status": "TEST_paused"}})
        try:
            data = {"type": "flight", "provider": "Delta", "confirmation": "TESTAB", "return_flight_number": "DL901",
                    "return_depart_airport": "ATL", "return_depart_time": "2027-03-14T09:00",
                    "return_arrive_airport": "LAX", "cost": 250, "amount_paid": 100}
            did = self._draft(mdb, s.user_id, data)
            r = s.post(f"{BASE_URL}/api/inbox/drafts/confirm-all", json={"competition_id": comp["id"]})
            assert r.status_code == 200, r.text
            res = r.json()
            allb = [x for x in s.get(f"{BASE_URL}/api/bookings", params={"competition_id": comp["id"]}).json()
                    if x["type"] == "flight"]
            mdb.inbox_drafts.delete_one({"id": did})
        finally:
            mdb.inbox_drafts.update_many({"id": {"$in": others}}, {"$set": {"status": "pending"}})
        for x in allb:
            s.delete(f"{BASE_URL}/api/bookings/{x['id']}")
        print(res)
        assert res["created"] == 1 and not res["duplicates"]
        assert len(allb) == 1 and allb[0]["cost"] == 820 and allb[0]["amount_paid"] == 400
