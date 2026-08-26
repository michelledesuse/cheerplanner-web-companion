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
import secrets
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
from core.entitlements import grant_lifetime  # noqa: E402

DEMO_EMAIL = "demo@cheerplanner.app"
DEMO_PASSWORD = "CheerDemo2026!"
DEMO_NAME = "Jordan"

# ParentGuard demo — minor athletes' OWN logins (separate accounts, NOT personnel)
MIA_ATHLETE_EMAIL = "mia.athlete@cheerplanner.app"      # PENDING approval
MIA_ATHLETE_PASSWORD = "CheerDemo2026!"
SOPHIA_ATHLETE_EMAIL = "sophia.athlete@cheerplanner.app"  # ALREADY approved
SOPHIA_ATHLETE_PASSWORD = "CheerDemo2026!"

# Personnel + co-parent logins so parent↔coach and parent↔parent chats are demoable
COACH_EMAIL = "coach.casey@cheerplanner.app"
COACH_PASSWORD = "CheerDemo2026!"
COPARENT_EMAIL = "parent.taylor@cheerplanner.app"
COPARENT_PASSWORD = "CheerDemo2026!"

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

    # Resolve the demo user's household + wipe ParentGuard / chat demo state so
    # re-runs always land on the same pending-approval scenario.
    h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    household_id = h["id"] if h else None
    mia_login = await db.users.find_one({"email": MIA_ATHLETE_EMAIL})
    mia_login_id = mia_login["id"] if mia_login else None
    if household_id:
        await db.athlete_chat_links.delete_many({"household_id": household_id})
        await db.team_messages.delete_many({"household_id": household_id})
        await db.chat_channels.delete_many({"household_id": household_id})
        await db.chat_reads.delete_many({"household_id": household_id})
        await db.households.update_one(
            {"id": household_id},
            {"$set": {"member_user_ids": [user_id], "team_hub_member_user_ids": [], "chat_athlete_user_ids": []}},
        )
    print("Cleared previous ParentGuard / chat demo state.")

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

    # ---- ParentGuard: two MINORS showing both states side by side.
    #   • Mia Johnson (age 11) — PENDING parent approval (chat OFF).
    #   • Sophia Lee (age 12)  — ALREADY approved by parent (chat ON).
    # Guardian for both = the demo account owner, so the reviewer can toggle live.
    async def _seed_minor(display_name: str, email: str, password: str, age: int, approved: bool):
        rid = next((r for r, n, role in roster_ids if n == display_name), None)
        if not rid or not household_id:
            return
        dob = today.replace(year=today.year - age)
        await db.roster.update_one(
            {"id": rid},
            {"$set": {"dob": dob.isoformat(), "parent_email": DEMO_EMAIL, "adult_athlete": False}},
        )
        login = await db.users.find_one({"email": email})
        if login:
            login_id = login["id"]
            await db.users.update_one(
                {"id": login_id},
                {"$set": {"password_hash": hash_password(password), "name": display_name, "team_access": False}},
            )
        else:
            login_id = str(uuid.uuid4())
            await db.users.insert_one({
                "id": login_id, "email": email, "name": display_name,
                "password_hash": hash_password(password), "team_access": False, "created_at": now_iso(),
            })
        await db.households.update_one({"id": household_id}, {"$addToSet": {"chat_athlete_user_ids": login_id}})
        await db.athlete_chat_links.update_one(
            {"household_id": household_id, "roster_id": rid},
            {"$set": {"athlete_user_id": login_id, "chat_enabled": approved, "invite_code": None, "linked_at": now_iso(),
                      **({"approved_by": user_id, "approved_at": now_iso()} if approved else {})},
             "$setOnInsert": {"created_at": now_iso()}},
            upsert=True,
        )
        state = "APPROVED (chat ON)" if approved else "PENDING approval (chat OFF)"
        print(f"ParentGuard → {display_name} (age {age}) {state}; login {email}")

    await _seed_minor("Mia Johnson", MIA_ATHLETE_EMAIL, MIA_ATHLETE_PASSWORD, 11, approved=False)
    await _seed_minor("Sophia Lee", SOPHIA_ATHLETE_EMAIL, SOPHIA_ATHLETE_PASSWORD, 12, approved=True)

    # ---- Unlock Premium for the reviewer so paywalled features are testable.
    if household_id:
        await grant_lifetime(user_id=user_id, household_id=household_id, source="admin_grant",
                             reason="Apple Review", label="Apple Review")
        print("Granted Lifetime Premium to the demo/reviewer account.")

    # ---- Coach + co-parent logins so parent↔coach and parent↔parent chats are
    # demoable, plus a ready-made "Parents & Coach" channel with real messages.
    async def _upsert_user(email, name, password, team_access):
        u = await db.users.find_one({"email": email})
        fields = {"name": name, "password_hash": hash_password(password),
                  "team_access": team_access, "chat_guidelines_accepted_at": now_iso()}
        if u:
            await db.users.update_one({"id": u["id"]}, {"$set": fields})
            return u["id"]
        uid = str(uuid.uuid4())
        await db.users.insert_one({"id": uid, "email": email, "created_at": now_iso(), **fields})
        return uid

    if household_id:
        coach_id = await _upsert_user(COACH_EMAIL, "Coach Casey", COACH_PASSWORD, True)
        coparent_id = await _upsert_user(COPARENT_EMAIL, "Taylor (Parent)", COPARENT_PASSWORD, False)
        await db.households.update_one(
            {"id": household_id},
            {"$addToSet": {"team_hub_member_user_ids": coach_id, "member_user_ids": coparent_id}},
        )
        # Land the coach on the demo team hub (they may collaborate on several).
        await db.users.update_one({"id": coach_id}, {"$set": {"active_hub_id": household_id}})
        ch_id = secrets.token_urlsafe(8)
        await db.chat_channels.insert_one({
            "id": ch_id, "household_id": household_id, "name": "Parents & Coach", "kind": "team",
            "member_user_ids": [coparent_id, coach_id, user_id], "created_by": coparent_id,
            "family_view": False, "created_at": now_iso(),
        })
        base2 = datetime.now(timezone.utc) - timedelta(hours=3)
        cmsgs = [
            (coparent_id, "Taylor (Parent)", "Hi Coach! Quick question about Saturday's call time."),
            (coach_id, "Coach Casey", "Hi Taylor — call time is 7:00am, doors open 6:45. 🙌"),
            (user_id, DEMO_NAME, "Thanks both! I'll add it to the group calendar."),
        ]
        for i, (sid, sname, text) in enumerate(cmsgs):
            await db.team_messages.insert_one({
                "id": secrets.token_urlsafe(9), "household_id": household_id, "channel_id": ch_id,
                "sender_id": sid, "sender_name": sname, "text": text,
                "media": [], "reactions": {}, "mentions": [],
                "created_at": iso(base2 + timedelta(minutes=i * 10)),
            })
        print(f"Seeded coach ({COACH_EMAIL}) + co-parent ({COPARENT_EMAIL}) + 'Parents & Coach' channel.")

    # ---- Owner accepts Community Guidelines so the reviewer can open Team Chat.
    await db.users.update_one({"id": user_id}, {"$set": {"chat_guidelines_accepted_at": now_iso()}})

    # ---- A few personnel messages in the main team thread (so chat isn't empty).
    if household_id:
        base = datetime.now(timezone.utc) - timedelta(hours=6)
        seed_msgs = [
            "Welcome to the team chat! 🎉 Please keep it kind and on-topic.",
            "Reminder: full-out run-throughs at Saturday practice — bring water! 💦",
            "Banquet meal orders are due Friday. Fill out the form when you get a sec.",
        ]
        for i, text in enumerate(seed_msgs):
            await db.team_messages.insert_one({
                "id": secrets.token_urlsafe(9), "household_id": household_id, "channel_id": None,
                "sender_id": user_id, "sender_name": DEMO_NAME, "text": text,
                "media": [], "reactions": {}, "mentions": [],
                "created_at": iso(base + timedelta(minutes=i * 20)),
            })
        print("Seeded 3 team-chat messages in the main thread.")

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
