# Setup/teardown helper for inbox flight-merge picker UI test (iteration 153)
import os, sys, json, uuid, datetime
import requests
from pymongo import MongoClient

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
STATE = "/tmp/flight_merge_ui_state.json"


def login():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "demo@cheerplanner.app", "password": "CheerDemo2026!"})
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token"), d["user"]["id"]


def setup():
    tok, uid = login()
    h = {"Authorization": f"Bearer {tok}"}
    c = requests.post(f"{BASE}/api/competitions", headers=h, json={
        "name": "TEST_MergePickerComp", "event_date": "2026-06-10", "end_date": "2026-06-12",
        "location": "Orlando, FL"}).json()
    cid = c["id"]
    b1 = requests.post(f"{BASE}/api/bookings", headers=h, json={
        "competition_id": cid, "type": "flight", "provider": "Delta",
        "segments": [{"direction": "outbound", "airline": "Delta", "flight_number": "DL100",
                      "depart_airport": "ATL", "arrive_airport": "MCO", "depart_time": "2026-06-09T08:00"}],
        "fare": {"outbound": {"passengers": 1, "base_fare": 300, "taxes_fees": 20}}}).json()
    b2 = requests.post(f"{BASE}/api/bookings", headers=h, json={
        "competition_id": cid, "type": "flight", "provider": "Southwest",
        "segments": [{"direction": "outbound", "airline": "Southwest", "flight_number": "WN555",
                      "depart_airport": "BWI", "arrive_airport": "MCO", "depart_time": "2026-06-09T10:00"}],
        "fare": {"outbound": {"passengers": 1, "base_fare": 150}}}).json()
    db = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))["test_database"]
    drafts = []
    for i, (fn, cost, paid) in enumerate([("DL100", 450, 450), ("AA777", 380, 0), ("UA900", 210, 0)]):
        did = str(uuid.uuid4())
        db.inbox_drafts.insert_one({
            "id": did, "user_id": uid, "status": "pending", "kind": "booking", "source": "paste",
            "summary": f"TEST_ flight {fn}", "raw_excerpt": f"TEST_ {fn} receipt",
            "data": {"type": "flight", "provider": {"DL100": "Delta", "AA777": "American", "UA900": "United"}[fn],
                     "confirmation": f"TST{i}", "cost": cost, "amount_paid": paid, "flight_number": fn,
                     "depart_airport": "ATL", "arrive_airport": "MCO", "depart_time": "2026-06-09T08:00",
                     "competition_name": "TEST_MergePickerComp"},
            "created_at": (datetime.datetime.utcnow() + datetime.timedelta(minutes=i)).isoformat() + "+00:00"})
        drafts.append(did)
    state = {"cid": cid, "b1": b1["id"], "b2": b2["id"], "drafts": drafts, "uid": uid}
    json.dump(state, open(STATE, "w"))
    print(json.dumps(state), b1.get("cost"), b2.get("cost"))


def show():
    tok, uid = login()
    h = {"Authorization": f"Bearer {tok}"}
    st = json.load(open(STATE))
    bs = requests.get(f"{BASE}/api/bookings", headers=h, params={"competition_id": st["cid"]}).json()
    for b in bs:
        if b.get("competition_id") == st["cid"]:
            print(b["id"], b.get("provider"), "cost", b.get("cost"), "paid", b.get("amount_paid"),
                  "segs", [s.get("flight_number") for s in b.get("segments") or []], "fare", b.get("fare"))
    db = MongoClient("mongodb://localhost:27017")["test_database"]
    for d in st["drafts"]:
        x = db.inbox_drafts.find_one({"id": d}, {"_id": 0, "status": 1, "summary": 1})
        print(d, x)


def teardown():
    tok, uid = login()
    h = {"Authorization": f"Bearer {tok}"}
    st = json.load(open(STATE))
    bs = requests.get(f"{BASE}/api/bookings", headers=h, params={"competition_id": st["cid"]}).json()
    for b in bs:
        if b.get("competition_id") == st["cid"]:
            print("del booking", b["id"], requests.delete(f"{BASE}/api/bookings/{b['id']}", headers=h).status_code)
    print("del comp", requests.delete(f"{BASE}/api/competitions/{st['cid']}", headers=h).status_code)
    db = MongoClient("mongodb://localhost:27017")["test_database"]
    for d in st["drafts"]:
        print("del draft", db.inbox_drafts.delete_one({"id": d, "user_id": uid}).deleted_count)


if __name__ == "__main__":
    {"setup": setup, "show": show, "teardown": teardown}[sys.argv[1]]()
