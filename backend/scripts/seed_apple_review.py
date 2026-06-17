"""
Seed a dedicated Apple Review user with a realistic dataset.

Run with:
    cd /app/backend && python scripts/seed_apple_review.py

Idempotent: drops & recreates everything owned by the review user every run,
so reviewers always see the same demo state. Safe to re-run any time before
the App Store submission.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow running this script from /app/backend so it can import server.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import importlib  # noqa: E402

# Lazy-import server so the rate limiter / FastAPI app doesn't try to start.
server = importlib.import_module("server")
hash_password = server.hash_password

# === REVIEW CREDENTIALS ===========================================
# Apple uses this exact email + password. Update Apple Connect's demo
# account fields to match if these ever change.
REVIEW_EMAIL = "applereview@cheerplanner.app"
REVIEW_PASSWORD = "Review2026!"
REVIEW_NAME = "App Review"
# ==================================================================

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


async def run() -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # ---- 1. Ensure the review user exists with a fresh password
    existing = await db.users.find_one({"email": REVIEW_EMAIL})
    if existing:
        user_id = existing["id"]
        # Reset the password every run in case it was changed.
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"password_hash": hash_password(REVIEW_PASSWORD), "name": REVIEW_NAME}},
        )
    else:
        user_id = await db.users.insert_one(
            {
                "id": (await _new_uuid()),
                "email": REVIEW_EMAIL,
                "name": REVIEW_NAME,
                "password_hash": hash_password(REVIEW_PASSWORD),
                "created_at": iso(datetime.now(timezone.utc)),
            }
        )
        user_id = (await db.users.find_one({"email": REVIEW_EMAIL}))["id"]

    print(f"User OK → {REVIEW_EMAIL}  (id={user_id})")

    # ---- 2. Wipe ALL data owned by this user (idempotent seed)
    purge_collections = [
        "athletes", "competitions", "bookings", "expenses", "payments",
        "fundraisers", "schedule_events", "packing_templates", "packing_lists",
        "teams",
    ]
    for c in purge_collections:
        await db[c].delete_many({"user_id": user_id})
    print("Cleared previous review data.")

    today = datetime.now(timezone.utc).date()

    # ---- 3. Teams
    team_ids = {}
    for name, color, season in [
        ("Senior Elite Coed 5", "#E11D48", "2025-2026"),
        ("Youth Level 2", "#0EA5E9", "2025-2026"),
    ]:
        doc = server.Team(user_id=user_id, name=name, color=color, season=season).model_dump()
        await db.teams.insert_one(doc)
        team_ids[name] = doc["id"]
    print(f"Teams seeded → {list(team_ids.keys())}")

    # ---- 4. Athletes (1 athlete, 1 coach in same household)
    ava_id = (await _insert(
        db, "athletes",
        server.Athlete(
            user_id=user_id, name="Ava Johnson", role="athlete",
            team="Senior Elite Coed 5", gym="California Allstars",
            avatar_color="#E11D48",
            team_ids=[team_ids["Senior Elite Coed 5"]],
        ),
    ))
    coach_id = (await _insert(
        db, "athletes",
        server.Athlete(
            user_id=user_id, name="Coach Maria", role="coach",
            gym="California Allstars", avatar_color="#0EA5E9",
            team_ids=list(team_ids.values()),
        ),
    ))
    print(f"Athletes seeded → Ava + Coach Maria")

    # ---- 5. Competitions (one upcoming with full travel + packing, one past)
    upcoming_date = today + timedelta(days=21)
    comp1_id = await _insert(
        db, "competitions",
        server.Competition(
            user_id=user_id,
            name="Summit Championship",
            location="ESPN Wide World of Sports",
            address="700 S Victory Way, Kissimmee, FL 34747",
            event_date=str(upcoming_date),
            event_time="14:00",
            end_date=str(upcoming_date + timedelta(days=2)),
            housing_required=True,
            booking_link="https://summit.varsity.com",
            notes="Bring two practice uniforms.",
            team_ids=[team_ids["Senior Elite Coed 5"]],
            team_meet_times=[
                server.TeamMeetTime(
                    team_id=team_ids["Senior Elite Coed 5"],
                    date=str(upcoming_date),
                    meet_time="13:00",
                    performance_time="14:30",
                    performance_location="Arena A",
                ),
                server.TeamMeetTime(
                    team_id=team_ids["Senior Elite Coed 5"],
                    date=str(upcoming_date + timedelta(days=1)),
                    meet_time="11:30",
                    performance_time="13:00",
                    performance_location="Arena B",
                ),
            ],
            teams_to_watch=[
                server.TeamToWatch(
                    name="Cheer Athletics Cheetahs",
                    date=str(upcoming_date + timedelta(days=1)),
                    location="Arena A",
                    performance_time="16:00",
                ),
            ],
        ),
    )
    past_date = today - timedelta(days=45)
    await _insert(
        db, "competitions",
        server.Competition(
            user_id=user_id,
            name="Worlds Tryout",
            location="Anaheim Convention Center",
            address="800 W Katella Ave, Anaheim, CA 92802",
            event_date=str(past_date),
            housing_required=False,
        ),
    )
    print("Competitions seeded → Summit + Worlds Tryout (past).")

    # ---- 6. Bookings on the upcoming competition (hotel, flight, car)
    await _insert(
        db, "bookings",
        server.Booking(
            user_id=user_id, competition_id=comp1_id, type="hotel",
            provider="Wyndham Lake Buena Vista", address="1850 Hotel Plaza Blvd, Lake Buena Vista, FL 32830",
            confirmation="WLB78421", cost=620.00, amount_paid=200.00,
            check_in=str(upcoming_date - timedelta(days=1)),
            check_out=str(upcoming_date + timedelta(days=2)),
            check_in_time="15:00",
            check_out_time="11:00",
            cancel_by=str(upcoming_date - timedelta(days=7)),
        ),
    )
    await _insert(
        db, "bookings",
        server.Booking(
            user_id=user_id, competition_id=comp1_id, type="flight",
            provider="Southwest", address="2800 N Terminal Rd, Houston, TX 77032",
            confirmation="SW8H29K",
            outbound_cost=320.00, return_cost=320.00, amount_paid=640.00,
            depart_at=iso(datetime.combine(upcoming_date - timedelta(days=1), datetime.min.time().replace(hour=9))),
            return_depart_at=iso(datetime.combine(upcoming_date + timedelta(days=2), datetime.min.time().replace(hour=17))),
            outbound_flight_number="WN1402",
            return_flight_number="WN3187",
        ),
    )
    await _insert(
        db, "bookings",
        server.Booking(
            user_id=user_id, competition_id=comp1_id, type="car",
            provider="Enterprise", confirmation="ENT-993021",
            cost=180.00, amount_paid=180.00,
            pickup_at=iso(datetime.combine(upcoming_date - timedelta(days=1), datetime.min.time().replace(hour=12))),
            dropoff_at=iso(datetime.combine(upcoming_date + timedelta(days=2), datetime.min.time().replace(hour=18))),
            pickup_location="Orlando Intl Airport, 9304 Jeff Fuqua Blvd, Orlando, FL 32827",
            dropoff_location="Orlando Intl Airport, 9304 Jeff Fuqua Blvd, Orlando, FL 32827",
        ),
    )
    print("Bookings seeded → hotel + flight + car.")

    # ---- 7. Expenses (mix paid + open, with due dates)
    expense_ids = {}
    for label, amt, days_offset, paid, athlete_id, category in [
        ("Tuition - Sep", 350.00, 5, False, ava_id, "Tuition"),
        ("Choreography fee", 250.00, 12, False, ava_id, "Choreography"),
        ("Uniform deposit", 180.00, -10, True, ava_id, "Uniform"),
        ("Summit registration", 480.00, 18, False, ava_id, "Registration"),
        ("Coach travel - hotel", 200.00, -2, True, coach_id, "Travel"),
    ]:
        due = today + timedelta(days=days_offset)
        eid = await _insert(
            db, "expenses",
            server.ExpenseEntry(
                user_id=user_id, athlete_id=athlete_id, category=category,
                amount=amt, due_date=str(due),
                incurred_on=str(today - timedelta(days=30)),
                paid=paid, note=label,
            ),
        )
        expense_ids[label] = eid
    print("Expenses seeded.")

    # ---- 8. Payments (showcase waterfall: one $200 covers Uniform fully)
    await _insert(
        db, "payments",
        server.PaymentEntry(
            user_id=user_id, athlete_id=ava_id,
            amount=180.00, paid_on=str(today - timedelta(days=12)),
            method="card", note="Uniform deposit",
            applied_expense_ids=[expense_ids["Uniform deposit"]],
            allocations=[server.PaymentAllocation(expense_id=expense_ids["Uniform deposit"], amount=180.00)],
        ),
    )
    await _insert(
        db, "payments",
        server.PaymentEntry(
            user_id=user_id, athlete_id=coach_id,
            amount=200.00, paid_on=str(today - timedelta(days=3)),
            method="card", note="Coach travel",
            applied_expense_ids=[expense_ids["Coach travel - hotel"]],
            allocations=[server.PaymentAllocation(expense_id=expense_ids["Coach travel - hotel"], amount=200.00)],
        ),
    )
    print("Payments seeded (waterfall examples).")

    # ---- 9. Fundraisers
    await _insert(
        db, "fundraisers",
        server.Fundraiser(
            user_id=user_id, name="Spring Car Wash",
            amount_raised=240.00,
            raised_on=str(today - timedelta(days=2)),
            note="Hosted at the gym parking lot.",
        ),
    )
    print("Fundraiser seeded.")

    # ---- 10. Schedule events (a recurring practice + one private lesson)
    from datetime import date as _d
    next_tuesday = today + timedelta(days=(1 - today.weekday()) % 7 or 7)
    for i in range(6):
        d = next_tuesday + timedelta(weeks=i)
        await _insert(
            db, "schedule_events",
            server.ScheduleEvent(
                user_id=user_id, athlete_ids=[ava_id], event_type="practice",
                title="Team practice",
                location="California Allstars - Mira Mesa",
                address="9750 Miramar Rd, San Diego, CA 92126",
                date=str(d), start_time="18:00", end_time="20:00",
            ),
        )
    await _insert(
        db, "schedule_events",
        server.ScheduleEvent(
            user_id=user_id, athlete_ids=[ava_id], event_type="private_lesson",
            title="Tumbling with Coach Jay",
            location="Power Tumbling Center",
            date=str(today + timedelta(days=4)),
            start_time="16:30", end_time="17:30",
        ),
    )
    print("Schedule seeded.")

    print("\n=================================================")
    print("APPLE REVIEW ACCOUNT READY")
    print(f"  Email:    {REVIEW_EMAIL}")
    print(f"  Password: {REVIEW_PASSWORD}")
    print("=================================================")


async def _insert(db, collection: str, model) -> str:
    doc = model.model_dump()
    await db[collection].insert_one(doc)
    return doc["id"]


async def _new_uuid() -> str:
    import uuid
    return str(uuid.uuid4())


if __name__ == "__main__":
    asyncio.run(run())
