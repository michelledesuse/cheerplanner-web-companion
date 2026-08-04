"""
Seed a CLEAN marketing/demo account for App Store screenshots.

Separate from the Apple Review account so screenshots stay pristine (no test
clutter). Idempotent: wipes and recreates everything owned by the demo user.

Run:
    cd /app/backend && python scripts/seed_marketing_demo.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
import core.models as server  # noqa: E402  (models live here; aliased as `server` for brevity)
from core.security import hash_password  # noqa: E402

DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASSWORD = "CheerDemo2026!"
DEMO_NAME = "Jordan"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def now_iso() -> str:
    return iso(datetime.now(timezone.utc))


async def _insert(db, collection: str, model) -> str:
    doc = model.model_dump()
    await db[collection].insert_one(doc)
    return doc["id"]


async def run() -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    existing = await db.users.find_one({"email": DEMO_EMAIL})
    if existing:
        user_id = existing["id"]
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"password_hash": hash_password(DEMO_PASSWORD), "name": DEMO_NAME, "team_access": True}},
        )
    else:
        user_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": user_id, "email": DEMO_EMAIL, "name": DEMO_NAME,
            "password_hash": hash_password(DEMO_PASSWORD), "team_access": True,
            "created_at": now_iso(),
        })
    print(f"Demo user OK → {DEMO_EMAIL} (id={user_id})")

    purge = [
        "athletes", "competitions", "bookings", "expenses", "payments",
        "fundraisers", "schedule_events", "packing_templates", "packing_lists",
        "teams", "roster", "team_forms", "team_form_responses", "seasons",
        "size_sheets", "signups", "paperwork", "attendance_sessions",
        "sheet_blocks", "broadcast_history", "broadcast_templates",
    ]
    for c in purge:
        await db[c].delete_many({"user_id": user_id})
    print("Cleared previous demo data.")

    today = datetime.now(timezone.utc).date()

    # ---- Teams (Blue & White branding)
    team_ids = {}
    for name, color in [("Senior Elite Coed 5", "#2563EB"), ("Youth Level 2", "#0EA5E9")]:
        doc = server.Team(user_id=user_id, name=name, color=color, season="2025-2026").model_dump()
        await db.teams.insert_one(doc)
        team_ids[name] = doc["id"]

    # ---- Athletes (household view: 2 athletes)
    ava_id = await _insert(db, "athletes", server.Athlete(
        user_id=user_id, name="Ava Johnson", role="athlete", team="Senior Elite Coed 5",
        gym="California Allstars", avatar_color="#2563EB", team_ids=[team_ids["Senior Elite Coed 5"]],
    ))
    mia_id = await _insert(db, "athletes", server.Athlete(
        user_id=user_id, name="Mia Johnson", role="athlete", team="Youth Level 2",
        gym="California Allstars", avatar_color="#0EA5E9", team_ids=[team_ids["Youth Level 2"]],
    ))

    # ---- Competitions (2 upcoming so the dashboard shows a "next competition")
    up1 = today + timedelta(days=16)
    comp1_id = await _insert(db, "competitions", server.Competition(
        user_id=user_id, name="Summit Championship", location="ESPN Wide World of Sports",
        address="700 S Victory Way, Kissimmee, FL 34747", event_date=str(up1), event_time="14:00",
        end_date=str(up1 + timedelta(days=2)), housing_required=True,
        booking_link="https://summit.varsity.com", notes="Bring two practice uniforms.",
        team_ids=[team_ids["Senior Elite Coed 5"]],
        team_meet_times=[
            server.TeamMeetTime(team_id=team_ids["Senior Elite Coed 5"], date=str(up1),
                                meet_time="13:00", performance_time="14:30", performance_location="Arena A"),
            server.TeamMeetTime(team_id=team_ids["Senior Elite Coed 5"], date=str(up1 + timedelta(days=1)),
                                meet_time="11:30", performance_time="13:00", performance_location="Arena B"),
        ],
        teams_to_watch=[server.TeamToWatch(name="Cheer Athletics Cheetahs",
                        date=str(up1 + timedelta(days=1)), location="Arena A", performance_time="16:00")],
    ))
    up2 = today + timedelta(days=38)
    await _insert(db, "competitions", server.Competition(
        user_id=user_id, name="Spirit Nationals", location="Anaheim Convention Center",
        address="800 W Katella Ave, Anaheim, CA 92802", event_date=str(up2), event_time="10:00",
        housing_required=False, team_ids=[team_ids["Youth Level 2"]],
    ))

    # ---- Bookings on comp1 (hotel + flight + car)
    await _insert(db, "bookings", server.Booking(
        user_id=user_id, competition_id=comp1_id, type="hotel", provider="Wyndham Lake Buena Vista",
        address="1850 Hotel Plaza Blvd, Lake Buena Vista, FL 32830", confirmation="WLB78421",
        cost=620.00, amount_paid=200.00, check_in=str(up1 - timedelta(days=1)),
        check_out=str(up1 + timedelta(days=2)), check_in_time="15:00", check_out_time="11:00",
        cancel_by=str(up1 - timedelta(days=7)),
    ))
    await _insert(db, "bookings", server.Booking(
        user_id=user_id, competition_id=comp1_id, type="flight", provider="Southwest",
        confirmation="SW8H29K", outbound_cost=320.00, return_cost=320.00, amount_paid=640.00,
        depart_at=iso(datetime.combine(up1 - timedelta(days=1), datetime.min.time().replace(hour=9))),
        return_depart_at=iso(datetime.combine(up1 + timedelta(days=2), datetime.min.time().replace(hour=17))),
        outbound_flight_number="WN1402", return_flight_number="WN3187",
    ))
    await _insert(db, "bookings", server.Booking(
        user_id=user_id, competition_id=comp1_id, type="car", provider="Enterprise",
        confirmation="ENT-993021", cost=180.00, amount_paid=180.00,
        pickup_at=iso(datetime.combine(up1 - timedelta(days=1), datetime.min.time().replace(hour=12))),
        dropoff_at=iso(datetime.combine(up1 + timedelta(days=2), datetime.min.time().replace(hour=18))),
        pickup_location="Orlando Intl Airport, 9304 Jeff Fuqua Blvd, Orlando, FL 32827",
        dropoff_location="Orlando Intl Airport, 9304 Jeff Fuqua Blvd, Orlando, FL 32827",
    ))

    # ---- Expenses (mix paid + open)
    exp = {}
    for label, amt, days, paid, aid, cat in [
        ("Tuition - Sep", 350.00, 6, False, ava_id, "Tuition"),
        ("Choreography fee", 250.00, 13, False, ava_id, "Choreography"),
        ("Uniform deposit", 180.00, -10, True, ava_id, "Uniform"),
        ("Summit registration", 480.00, 20, False, ava_id, "Registration"),
        ("Youth tuition - Sep", 220.00, 6, False, mia_id, "Tuition"),
    ]:
        due = today + timedelta(days=days)
        exp[label] = await _insert(db, "expenses", server.ExpenseEntry(
            user_id=user_id, athlete_id=aid, category=cat, amount=amt, due_date=str(due),
            incurred_on=str(today - timedelta(days=25)), paid=paid, note=label,
        ))

    # ---- Payment (waterfall: covers the uniform deposit)
    await _insert(db, "payments", server.PaymentEntry(
        user_id=user_id, athlete_id=ava_id, amount=180.00, paid_on=str(today - timedelta(days=10)),
        method="card", note="Uniform deposit",
        applied_expense_ids=[exp["Uniform deposit"]],
        allocations=[server.PaymentAllocation(expense_id=exp["Uniform deposit"], amount=180.00)],
    ))

    # ---- Fundraiser
    await _insert(db, "fundraisers", server.Fundraiser(
        user_id=user_id, name="Spring Car Wash", amount_raised=340.00,
        raised_on=str(today - timedelta(days=3)), note="Hosted at the gym parking lot.",
    ))

    # ---- Schedule (recurring practice + private lesson)
    next_tue = today + timedelta(days=(1 - today.weekday()) % 7 or 7)
    for i in range(6):
        d = next_tue + timedelta(weeks=i)
        await _insert(db, "schedule_events", server.ScheduleEvent(
            user_id=user_id, athlete_ids=[ava_id], event_type="practice", title="Team practice",
            location="California Allstars - Mira Mesa", address="9750 Miramar Rd, San Diego, CA 92126",
            date=str(d), start_time="18:00", end_time="20:00",
        ))
    await _insert(db, "schedule_events", server.ScheduleEvent(
        user_id=user_id, athlete_ids=[ava_id], event_type="private_lesson", title="Tumbling with Coach Jay",
        location="Power Tumbling Center", date=str(today + timedelta(days=3)),
        start_time="16:30", end_time="17:30",
    ))

    # ---- Team Hub roster (personnel + athletes)
    roster = [
        ("Coach Maria", "coach"), ("Team Rep Dana", "team_rep"),
        ("Ava Johnson", "athlete"), ("Mia Johnson", "athlete"), ("Sophia Lee", "athlete"),
        ("Harper Davis", "athlete"), ("Chloe Kim", "athlete"), ("Layla Ruiz", "athlete"),
    ]
    roster_ids = []
    for name, role in roster:
        rid = str(uuid.uuid4())
        first, _, last = name.partition(" ")
        await db.roster.insert_one({
            "id": rid, "user_id": user_id, "name": name, "first_name": first, "last_name": last or "",
            "role": role, "team_ids": [team_ids["Senior Elite Coed 5"]],
            "created_at": now_iso(),
        })
        roster_ids.append((rid, name, role))

    # ---- A polished Team Form with a live tally
    qid_meal = uuid.uuid4().hex[:8]
    qid_extra = uuid.uuid4().hex[:8]
    form_id = str(uuid.uuid4())
    await db.team_forms.insert_one({
        "id": form_id, "user_id": user_id, "name": "Banquet Meal Order",
        "description": "Pick your entrée for the end-of-season banquet.", "locked": False,
        "questions": [
            {"id": qid_meal, "label": "Entrée choice", "type": "choice",
             "options": ["Chicken", "Pasta", "Veggie"], "required": True, "order": 0},
            {"id": qid_extra, "label": "Any dietary notes?", "type": "paragraph",
             "options": [], "required": False, "order": 1},
        ],
        "photos": [], "competition_ids": [], "event_ids": [], "season_ids": [],
        "close_at": None, "created_at": now_iso(), "updated_at": now_iso(),
    })
    # responses to build a tally (Chicken x4, Pasta x2, Veggie x1)
    meal_by_index = ["Chicken", "Chicken", "Chicken", "Chicken", "Pasta", "Pasta", "Veggie"]
    athletes_only = [(rid, name) for rid, name, role in roster_ids if role == "athlete"]
    for (rid, name), meal in zip(athletes_only, meal_by_index):
        await db.team_form_responses.insert_one({
            "id": str(uuid.uuid4()), "form_id": form_id, "user_id": user_id, "member_id": rid,
            "respondent_name": name, "answers": {qid_meal: meal}, "source": "coach",
            "created_at": now_iso(), "updated_at": now_iso(),
        })

    # ---- Set the household theme to Blue & White (brand palette)
    await db.households.update_one(
        {"member_user_ids": user_id},
        {"$set": {"theme": {"preset_id": "cheerplanner", "custom": None, "saved": []}}},
    )
    print("Household theme set → Blue & White (cheerplanner preset).")

    print("\n=================================================")
    print("MARKETING DEMO ACCOUNT READY")
    print(f"  Email:    {DEMO_EMAIL}")
    print(f"  Password: {DEMO_PASSWORD}")
    print("=================================================")


if __name__ == "__main__":
    asyncio.run(run())
