"""Seed the marketing/demo account on PRODUCTION via the public API.

Cannot touch the production DB directly (no MONGO_URL here), so this signs in as
the demo account and creates data through authenticated REST calls. Safe to re-run:
it clears the account's existing content first via the API where possible.
"""
import sys
from datetime import date, datetime, timedelta, timezone

import requests

BASE = "https://spirit-finance-2.emergent.host/api"
EMAIL = "demo@cheerplanner.app"
PASSWORD = "CheerDemo2026!"

s = requests.Session()


def login():
    r = s.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    print("logged in")


def post(path, body):
    r = s.post(f"{BASE}{path}", json=body, timeout=30)
    if r.status_code >= 300:
        print(f"  !! POST {path} -> {r.status_code} {r.text[:180]}")
        return None
    return r.json()


def patch(path, body):
    r = s.patch(f"{BASE}{path}", json=body, timeout=30)
    if r.status_code >= 300:
        print(f"  !! PATCH {path} -> {r.status_code} {r.text[:180]}")
        return None
    return r.json()


def get(path):
    r = s.get(f"{BASE}{path}", timeout=30)
    return r.json() if r.status_code < 300 else []


def delete(path):
    s.delete(f"{BASE}{path}", timeout=30)


def wipe():
    # Clear anything already present so re-runs stay clean.
    for a in get("/athletes"):
        delete(f"/athletes/{a['id']}")
    for c in get("/competitions"):
        delete(f"/competitions/{c['id']}")
    for f in get("/fundraisers"):
        delete(f"/fundraisers/{f['id']}")
    for t in get("/teams"):
        delete(f"/teams/{t['id']}")
    for m in get("/roster"):
        delete(f"/roster/{m['id']}")
    for sig in get("/team/signups"):
        delete(f"/team/signups/{sig['id']}")
    for fm in get("/forms"):
        delete(f"/forms/{fm['id']}")
    print("wiped existing demo content")


def run():
    login()
    wipe()
    today = date.today()

    def iso(d):
        return d.isoformat()

    # Theme: Blue & White brand
    patch("/household/theme", {"preset_id": "cheerplanner"})

    # Teams
    teams = {}
    for name, color in [("Senior Elite Coed 5", "#2563EB"), ("Youth Level 2", "#0EA5E9")]:
        t = post("/teams", {"name": name, "color": color, "season": "2025-2026"})
        if t:
            teams[name] = t["id"]
    print("teams:", list(teams.values()))

    # Athletes
    ava = post("/athletes", {"name": "Ava Johnson", "role": "athlete", "team": "Senior Elite Coed 5",
                             "gym": "California Allstars", "avatar_color": "#2563EB",
                             "team_ids": [teams.get("Senior Elite Coed 5")] if teams else []})
    mia = post("/athletes", {"name": "Mia Johnson", "role": "athlete", "team": "Youth Level 2",
                             "gym": "California Allstars", "avatar_color": "#0EA5E9",
                             "team_ids": [teams.get("Youth Level 2")] if teams else []})
    ava_id = ava["id"] if ava else None
    mia_id = mia["id"] if mia else None
    print("athletes:", ava_id, mia_id)

    # Competitions
    up1 = today + timedelta(days=16)
    comp1 = post("/competitions", {
        "name": "Summit Championship", "location": "ESPN Wide World of Sports",
        "address": "700 S Victory Way, Kissimmee, FL 34747", "event_date": iso(up1),
        "event_time": "14:00", "end_date": iso(up1 + timedelta(days=2)), "housing_required": True,
        "booking_link": "https://summit.varsity.com", "notes": "Bring two practice uniforms.",
        "team_ids": [teams.get("Senior Elite Coed 5")] if teams else [],
    })
    up2 = today + timedelta(days=38)
    post("/competitions", {
        "name": "Spirit Nationals", "location": "Anaheim Convention Center",
        "address": "800 W Katella Ave, Anaheim, CA 92802", "event_date": iso(up2),
        "event_time": "10:00", "housing_required": False,
        "team_ids": [teams.get("Youth Level 2")] if teams else [],
    })
    comp1_id = comp1["id"] if comp1 else None
    print("competitions comp1:", comp1_id)

    # Booking (hotel) on comp1
    if comp1_id:
        post("/bookings", {
            "competition_id": comp1_id, "type": "hotel", "provider": "Wyndham Lake Buena Vista",
            "address": "1850 Hotel Plaza Blvd, Lake Buena Vista, FL 32830", "confirmation": "WLB78421",
            "cost": 620.0, "amount_paid": 200.0, "check_in": iso(up1 - timedelta(days=1)),
            "check_out": iso(up1 + timedelta(days=2)), "check_in_time": "15:00", "check_out_time": "11:00",
            "cancel_by": iso(up1 - timedelta(days=7)),
        })
        post("/bookings", {
            "competition_id": comp1_id, "type": "car", "provider": "Enterprise",
            "confirmation": "ENT-993021", "cost": 180.0, "amount_paid": 180.0,
            "pickup_location": "Orlando Intl Airport", "dropoff_location": "Orlando Intl Airport",
        })

    # Expenses
    exp_ids = {}
    for label, amt, days, paid, aid, cat in [
        ("Tuition - Sep", 350.0, 6, False, ava_id, "Tuition"),
        ("Choreography fee", 250.0, 13, False, ava_id, "Choreography"),
        ("Uniform deposit", 180.0, -10, True, ava_id, "Uniform"),
        ("Summit registration", 480.0, 20, False, ava_id, "Registration"),
        ("Youth tuition - Sep", 220.0, 6, False, mia_id, "Tuition"),
    ]:
        if not aid:
            continue
        due = today + timedelta(days=days)
        res = post("/expenses", {
            "athlete_id": aid, "category": cat, "amount": amt, "due_date": iso(due),
            "incurred_on": iso(today - timedelta(days=25)), "paid": paid, "note": label,
        })
        if res and isinstance(res, list) and res:
            exp_ids[label] = res[0]["id"]
    print("expenses:", list(exp_ids.keys()))

    # Payment (covers the uniform deposit)
    if ava_id and exp_ids.get("Uniform deposit"):
        post("/payments", {
            "athlete_id": ava_id, "amount": 180.0, "paid_on": iso(today - timedelta(days=10)),
            "method": "card", "note": "Uniform deposit",
            "applied_expense_ids": [exp_ids["Uniform deposit"]],
            "allocations": [{"expense_id": exp_ids["Uniform deposit"], "amount": 180.0}],
        })

    # Fundraiser
    post("/fundraisers", {"name": "Spring Car Wash", "amount_raised": 340.0,
                          "raised_on": iso(today - timedelta(days=3)),
                          "note": "Hosted at the gym parking lot."})

    # Schedule (recurring practice)
    next_tue = today + timedelta(days=(1 - today.weekday()) % 7 or 7)
    for i in range(6):
        d = next_tue + timedelta(weeks=i)
        post("/schedule", {
            "title": "Team practice", "date": iso(d), "event_type": "practice",
            "athlete_ids": [ava_id] if ava_id else [],
            "location": "California Allstars - Mira Mesa",
            "address": "9750 Miramar Rd, San Diego, CA 92126",
            "start_time": "18:00", "end_time": "20:00",
        })

    # Team Hub roster
    sr = teams.get("Senior Elite Coed 5")
    for name, role in [
        ("Coach Maria", "coach"), ("Team Rep Dana", "team_rep"),
        ("Ava Johnson", "athlete"), ("Mia Johnson", "athlete"), ("Sophia Lee", "athlete"),
        ("Harper Davis", "athlete"), ("Chloe Kim", "athlete"), ("Layla Ruiz", "athlete"),
    ]:
        first, _, last = name.partition(" ")
        post("/roster", {"first_name": first, "last_name": last, "role": role,
                         "team_ids": [sr] if sr else []})

    # Team Form (Banquet Meal Order)
    post("/forms", {
        "name": "Banquet Meal Order",
        "description": "Pick your entrée for the end-of-season banquet.",
        "questions": [
            {"label": "Entrée choice", "type": "choice", "options": ["Chicken", "Pasta", "Veggie"], "required": True},
            {"label": "Any dietary notes?", "type": "paragraph", "required": False},
        ],
    })

    print("\n=== PROD DEMO SEED COMPLETE ===")
    print("athletes:", len(get("/athletes")), "| competitions:", len(get("/competitions")),
          "| roster:", len(get("/roster")), "| teams:", len(get("/teams")), "| forms:", len(get("/forms")))


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print("FATAL:", e)
        sys.exit(1)
