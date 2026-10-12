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

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
import core.models as server  # noqa: E402  (models live here; aliased as `server` for brevity)
from core.security import hash_password  # noqa: E402
from core.entitlements import grant_lifetime  # noqa: E402
from core.storage import put_object, APP_NAME  # noqa: E402
import base64 as _b64  # noqa: E402
import io as _io  # noqa: E402
from PIL import Image as _PILImage  # noqa: E402


def _png_thumb(data: bytes, box: int = 400) -> str:
    img = _PILImage.open(_io.BytesIO(data)).convert("RGB")
    img.thumbnail((box, box))
    out = _io.BytesIO()
    img.save(out, format="JPEG", quality=72)
    return "data:image/jpeg;base64," + _b64.b64encode(out.getvalue()).decode("utf-8")


def _gen_image(prompt: str, transparent: bool = False) -> bytes:
    """Generate one image with OpenAI GPT-Image-2 (sync; called via to_thread)."""
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    kwargs = {"model": os.environ.get("AI_DESIGNER_MODEL", "gpt-image-2"),
              "prompt": prompt, "size": "1024x1024", "n": 1}
    if transparent:
        kwargs["background"] = "transparent"
    resp = client.images.generate(**kwargs)
    return _b64.b64decode(resp.data[0].b64_json)

# The ONE account used for Apple App Review AND App Store screenshots.
DEMO_EMAIL = "applereview@cheerplanner.app"
DEMO_PASSWORD = "Review2026!"
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


async def run(purge: bool = True) -> None:
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

    purge_collections = [
        "athletes", "competitions", "bookings", "expenses", "payments",
        "fundraisers", "schedule_events", "packing_templates", "packing_lists",
        "teams", "roster", "team_forms", "team_form_responses", "seasons",
        "size_sheets", "signups", "paperwork", "attendance_sessions",
        "sheet_blocks", "broadcast_history", "broadcast_templates",
        "payment_trackers", "signup_sheets", "paperwork_sheets", "inbox_drafts",
        "broadcasts", "sms_messages", "place_reviews",
    ]
    if purge:
        for c in purge_collections:
            await db[c].delete_many({"user_id": user_id})
        print("Cleared previous demo data.")

    # Resolve (lazy-create) the demo user's household + wipe ParentGuard / chat
    # demo state so re-runs always land on the same pending-approval scenario.
    # On a fresh DB (e.g. production first boot) the household does not exist yet,
    # so we create it here — otherwise all household-scoped seeding (athletes,
    # teams, chat, calendar, forms, flyers) would be silently skipped.
    from core.helpers import _get_or_create_household
    h = await _get_or_create_household(user_id)
    household_id = h["id"]
    mia_login = await db.users.find_one({"email": MIA_ATHLETE_EMAIL})
    mia_login_id = mia_login["id"] if mia_login else None
    if household_id and purge:
        await db.athlete_chat_links.delete_many({"household_id": household_id})
        await db.team_messages.delete_many({"household_id": household_id})
        await db.chat_channels.delete_many({"household_id": household_id})
        await db.chat_reads.delete_many({"household_id": household_id})
        await db.team_events.delete_many({"household_id": household_id})
        await db.calendar_rsvps.delete_many({"household_id": household_id})
        await db.ai_designs.delete_many({"household_id": household_id})
        await db.brand_presets.delete_many({"household_id": household_id})
        await db.chat_media.delete_many({"household_id": household_id})
        await db.competition_results.delete_many({"household_id": household_id})
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
        gym="Elite Stars Allstars", avatar_color="#2563EB", team_ids=[team_ids["Senior Elite Coed 5"]],
    ))
    mia_id = await _insert(db, "athletes", server.Athlete(
        user_id=user_id, name="Mia Johnson", role="athlete", team="Youth Level 2",
        gym="Elite Stars Allstars", avatar_color="#0EA5E9", team_ids=[team_ids["Youth Level 2"]],
    ))

    # ---- Competitions (2 upcoming so the dashboard shows a "next competition")
    up1 = today + timedelta(days=16)
    comp1_id = await _insert(db, "competitions", server.Competition(
        user_id=user_id, name="Summit Championship", location="ESPN Wide World of Sports",
        address="700 S Victory Way, Kissimmee, FL 34747", event_date=str(up1), event_time="14:00",
        end_date=str(up1 + timedelta(days=2)), housing_required=True,
        booking_link="https://summit.varsity.com", notes="Bring two practice uniforms.",
        meet_time="12:30", meeting_location="Gate C entrance (HP Field House)",
        what_to_wear="Full competition uniform, white cheer shoes, high pony with the black game-day bow, competition makeup",
        day_details="• Warm-ups start at 1:15 PM\n• Awards at 6:00 PM in the Arena\n• Spectator wristbands at Gate A\n• Parking in Lot B — arrive early\n• No glass bottles allowed",
        spectator_fee=35.0, parking_fee=25.0,
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
    # Practices are a proper WEEKLY SERIES (shared series_id + recurrence_rule) so
    # the Team Hub import modal can offer "select the whole series" in one tap.
    next_tue = today + timedelta(days=(1 - today.weekday()) % 7 or 7)
    practice_series_id = str(uuid.uuid4())
    practice_rule = server.RecurrenceRule(frequency="weekly", days_of_week=[next_tue.weekday()], until=str(next_tue + timedelta(weeks=5)))
    for i in range(6):
        d = next_tue + timedelta(weeks=i)
        await _insert(db, "schedule_events", server.ScheduleEvent(
            user_id=user_id, athlete_ids=[ava_id], event_type="practice", title="Team practice",
            location="Elite Stars Allstars Gym", address="9750 Miramar Rd, San Diego, CA 92126",
            date=str(d), start_time="18:00", end_time="20:00",
            series_id=practice_series_id, recurrence_rule=practice_rule,
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
        # Give the coach an assigned "coach" team-member record so she shows in
        # the owner's Team list (active), not the New Members / role-needed queue.
        if not await db.team_members.find_one({"household_id": household_id, "user_id": coach_id}):
            _now = datetime.now(timezone.utc).isoformat()
            await db.team_members.insert_one({
                "id": secrets.token_urlsafe(9), "household_id": household_id, "user_id": coach_id,
                "status": "active", "role": "coach", "athlete_roster_id": None,
                "joined_at": _now, "assigned_at": _now,
            })
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

    # ---- Team Hub Calendar: a few upcoming events so the calendar looks alive.
    if household_id:
        today = datetime.now(timezone.utc)
        cal = [
            ("practice", "Full-Out Practice", "Elite Stars Allstars Gym", "18:00", "20:00", 3),
            ("competition", "Spirit Cup Regional", "Orlando Convention Center", "08:00", "17:00", 12),
            ("fundraiser", "Car Wash Fundraiser", "Elite Stars Gym Parking Lot", "10:00", "14:00", 20),
        ]
        for etype, title, loc, st, et, days in cal:
            await db.team_events.insert_one({
                "id": str(uuid.uuid4()), "household_id": household_id, "title": title,
                "event_type": etype, "location": loc, "address": "", "date": (today + timedelta(days=days)).date().isoformat(),
                "start_time": st, "end_time": et, "notes": "", "recurrence": {"freq": "none"},
                "created_by": user_id, "created_at": now_iso(),
            })
        print("Seeded 3 Team Hub calendar events.")

    # ---- Team Forms: a duplicated form so reviewers see the Duplicate feature.
    dup_meal = str(uuid.uuid4()); dup_extra = str(uuid.uuid4())
    await db.team_forms.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "name": "Banquet Meal Order (copy)",
        "description": "Pick your entrée for the end-of-season banquet.", "locked": False,
        "questions": [
            {"id": dup_meal, "label": "Entrée choice", "type": "choice",
             "options": ["Chicken", "Pasta", "Veggie"], "required": True, "order": 0},
            {"id": dup_extra, "label": "Any dietary notes?", "type": "paragraph",
             "options": [], "required": False, "order": 1},
        ],
        "photos": [], "competition_ids": [], "event_ids": [], "season_ids": [],
        "close_at": None, "created_at": now_iso(), "updated_at": now_iso(),
    })
    print("Seeded a duplicated Team Form.")

    # ---- Design a Flyer: brand preset + saved designs + one posted to chat.
    if household_id and os.environ.get("OPENAI_API_KEY"):
        try:
            design_prompts = [
                "A bold cheerleading competition poster, navy blue and gold, dynamic cheerleader mid-toss, sparkles, clean space for event text, professional",
                "A vibrant cheer tryouts flyer, energetic pom-poms and megaphone, navy and gold color theme, modern layout, space for details",
                "An elegant end-of-season banquet invitation, gold accents on navy, tasteful sparkle, formal cheer theme",
            ]
            logo_prompt = "A minimalist cheerleading team logo emblem: a megaphone crossed with a star, navy and gold, flat vector, centered"
            results = await asyncio.gather(
                asyncio.to_thread(_gen_image, logo_prompt, True),
                *[asyncio.to_thread(_gen_image, p, False) for p in design_prompts],
                return_exceptions=True,
            )
            logo_res, design_res = results[0], results[1:]
            # Brand preset (with generated transparent logo if available)
            brand_logo = ""
            if isinstance(logo_res, (bytes, bytearray)):
                small = _PILImage.open(_io.BytesIO(logo_res)); small.thumbnail((512, 512))
                bo = _io.BytesIO(); small.save(bo, format="PNG")
                brand_logo = "data:image/png;base64," + _b64.b64encode(bo.getvalue()).decode("utf-8")
            await db.brand_presets.insert_one({
                "id": secrets.token_urlsafe(9), "household_id": household_id, "owner_id": user_id,
                "name": "Elite Stars Allstars", "colors": ["#0A1F44", "#FFD700"],
                "logo": brand_logo, "created_at": now_iso(), "updated_at": now_iso(),
            })
            # Saved designs → My Designs library
            saved_paths = []
            titles = ["Regional Competition Poster", "Tryouts 2026 Flyer", "Season Banquet Invite"]
            for data, title in zip(design_res, titles):
                if not isinstance(data, (bytes, bytearray)):
                    continue
                did = secrets.token_urlsafe(10)
                path = f"{APP_NAME}/ai_designer/{household_id}/{user_id}/{uuid.uuid4()}.png"
                await asyncio.to_thread(put_object, path, bytes(data), "image/png")
                await db.ai_designs.insert_one({
                    "id": did, "household_id": household_id, "owner_id": user_id, "storage_path": path,
                    "prompt": title, "thumb": _png_thumb(bytes(data)), "size": "1024x1024", "created_at": now_iso(),
                })
                saved_paths.append((title, bytes(data)))
            # Post one flyer into Team Chat
            if saved_paths and household_id:
                title, data = saved_paths[0]
                media_id = secrets.token_urlsafe(10)
                cpath = f"{APP_NAME}/ai_designer/{household_id}/{user_id}/{uuid.uuid4()}.png"
                await asyncio.to_thread(put_object, cpath, data, "image/png")
                await db.chat_media.insert_one({
                    "id": media_id, "household_id": household_id, "owner_id": user_id,
                    "storage_path": cpath, "content_type": "image/png", "kind": "image",
                    "name": "flyer.png", "size": len(data), "created_at": now_iso(),
                })
                await db.team_messages.insert_one({
                    "id": secrets.token_urlsafe(9), "household_id": household_id, "channel_id": None,
                    "sender_id": user_id, "sender_name": DEMO_NAME,
                    "text": "Made this for Regionals with Design a Flyer! 🎀", 
                    "media": [{"id": media_id, "kind": "image", "content_type": "image/png", "name": "flyer.png"}],
                    "reactions": {}, "mentions": [], "created_at": iso(datetime.now(timezone.utc) - timedelta(minutes=30)),
                })
            print(f"Seeded Design-a-Flyer: 1 brand preset, {len(saved_paths)} designs, 1 posted to chat.")
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  Skipped Design-a-Flyer seeding ({type(e).__name__}: {str(e)[:120]}).")
    else:
        print("⚠️  Skipped Design-a-Flyer seeding (no OPENAI_API_KEY).")

    await _seed_review_extras(db, user_id, household_id, roster_ids, comp1_id,
                              coach_id if household_id else None, coparent_id if household_id else None)

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


async def _seed_review_extras(db, user_id, household_id, roster_ids, comp1_id, coach_id, coparent_id) -> None:
    """TeamHub tools, Smart Inbox, SMS history and Community Reviews so every
    screen a reviewer (or a screenshot) lands on has realistic data."""
    today = datetime.now(timezone.utc).date()
    athletes = [(rid, name) for rid, name, role in roster_ids if role == "athlete"]
    aids = [rid for rid, _ in athletes]

    # ---- Payment trackers (mix of fully paid, partial, unpaid)
    def _entries(paid_n, amount, partial=None):
        out = []
        for i, rid in enumerate(aids):
            if i < paid_n:
                out.append(server.TeamPaymentEntry(member_id=rid, paid=True, amount_paid=amount, method="Venmo",
                                                   paid_at=iso(datetime.now(timezone.utc) - timedelta(days=6 - i))))
            elif partial is not None and i == paid_n:
                out.append(server.TeamPaymentEntry(member_id=rid, paid=False, amount_paid=partial, method="Cash"))
        return out
    for order, (name, amt, paid_n, partial, note) in enumerate([
        ("Summit Team Bonding Dinner", 45.0, 4, 20.0, "Pizza + bowling the night before finals."),
        ("Coach Appreciation Gift", 20.0, 5, None, "Group gift for Coach Maria."),
        ("Banquet Tickets", 35.0, 2, None, "Covers dinner + awards."),
    ]):
        await _insert(db, "payment_trackers", server.PaymentTracker(
            user_id=user_id, name=name, amount=amt, note=note, order=order,
            links=[server.ExternalLink(label="Venmo", url="https://venmo.com/u/EliteStarsBooster")],
            entries=_entries(paid_n, amt, partial),
            competition_ids=[comp1_id] if order == 0 else [],
        ))

    # ---- Sign-up sheets
    def _claims(ids, qty=1):
        return [server.SignupClaim(member_id=r, qty=qty) for r in ids]
    await _insert(db, "signup_sheets", server.SignupSheet(user_id=user_id, name="Summit Snack & Hydration Crew", order=0,
        competition_ids=[comp1_id], slots=[
            server.SignupSlot(label="Water bottles (case)", kind="item", qty_needed=3, order=0, claims=_claims(aids[:2])),
            server.SignupSlot(label="Fruit trays", kind="item", qty_needed=2, order=1, claims=_claims(aids[2:4])),
            server.SignupSlot(label="Granola bars", kind="item", qty_needed=2, order=2, claims=_claims(aids[4:5])),
            server.SignupSlot(label="Bow & hair station helper", kind="duty", qty_needed=2, order=3, claims=_claims(aids[1:2])),
        ]))
    await _insert(db, "signup_sheets", server.SignupSheet(user_id=user_id, name="Spring Car Wash Shifts", order=1, slots=[
        server.SignupSlot(label="Morning shift", kind="time", time_label="10:00–12:00", qty_needed=4, order=0, claims=_claims(aids[:3])),
        server.SignupSlot(label="Afternoon shift", kind="time", time_label="12:00–2:00", qty_needed=4, order=1, claims=_claims(aids[3:5])),
    ]))

    # ---- Paperwork
    items = [server.PaperworkItem(label=l, order=i) for i, l in enumerate(
        ["Liability waiver", "Medical release", "Photo consent", "Travel permission"])]
    values = {}
    for i, rid in enumerate(aids):
        done_n = [4, 4, 3, 4, 2, 1][i % 6]
        values[rid] = {it.id: {"done": True, "note": None} for it in items[:done_n]}
    await _insert(db, "paperwork_sheets", server.PaperworkSheet(user_id=user_id, name="2025–26 Season Forms", items=items, values=values, order=0))
    hotel_items = [server.PaperworkItem(label=l, order=i) for i, l in enumerate(["Rooming list", "Emergency contact card"])]
    await _insert(db, "paperwork_sheets", server.PaperworkSheet(user_id=user_id, name="Summit Travel Packet", items=hotel_items, order=1,
        values={rid: {hotel_items[0].id: {"done": True, "note": None}} for rid in aids[:4]}))

    # ---- Attendance (last 3 practices)
    patterns = [
        ["present"] * 6,
        ["present", "present", "tardy", "present", "excused", "present"],
        ["present", "absent", "present", "present", "present", "tardy"],
    ]
    for order, (days_ago, pat) in enumerate(zip([2, 5, 9], patterns)):
        await _insert(db, "attendance_sessions", server.AttendanceSession(
            user_id=user_id, title="Team practice", date=str(today - timedelta(days=days_ago)), order=order,
            records={rid: st for rid, st in zip(aids, pat)}))

    # ---- Sizes
    cols = [server.SizeColumn(label=l, is_default=True, order=i) for i, l in enumerate(server.DEFAULT_SIZE_COLUMNS)]
    sizes = [("YM", "YM", "YS", "Y4"), ("YL", "YL", "YM", "Y5"), ("AS", "AS", "XS", "W6"),
             ("AM", "AM", "S", "W7"), ("YM", "YM", "YS", "Y3"), ("AS", "AXS", "XS", "W6.5")]
    sv = {rid: {cols[0].id: s[0], cols[1].id: s[1], cols[3].id: s[2], cols[4].id: s[3]} for rid, s in zip(aids, sizes)}
    await db.size_sheets.delete_many({"user_id": user_id})
    await _insert(db, "size_sheets", server.SizeSheet(user_id=user_id, columns=cols, values=sv))

    # ---- Competition results (shared with the team)
    if household_id:
        for order, (title, d, place, score, div) in enumerate([
            ("Winter Classic", 24, "1st", "96.4", "Senior Coed 5"),
            ("Battle at the Capitol", 52, "2nd", "94.1", "Senior Coed 5"),
            ("Fall Kickoff Showcase", 80, "1st", "92.8", "Senior Coed 5"),
        ]):
            await db.competition_results.insert_one({
                "id": str(uuid.uuid4()), "household_id": household_id, "competition_id": None, "title": title,
                "date": str(today - timedelta(days=d)), "placement": place, "score": score, "division": div,
                "notes": "Zero deductions — hit zero!" if order == 0 else "", "visibility": "team",
                "created_by": user_id, "created_at": now_iso(), "order": order, "archived": False,
            })

    # ---- Smart Inbox: drafts waiting for review
    for kind, source, summary, data in [
        ("booking", "email", "Hotel · Hyatt Regency Orlando · Conf HY55120",
         {"type": "hotel", "provider": "Hyatt Regency Orlando", "address": "9801 International Dr, Orlando, FL 32819",
          "confirmation": "HY55120", "cost": 489.0, "amount_paid": 0, "check_in": str(today + timedelta(days=37)),
          "check_out": str(today + timedelta(days=39)), "check_in_time": "16:00", "check_out_time": "11:00"}),
        ("expense", "screenshot", "Choreography · $275 due " + str(today + timedelta(days=12)),
         {"category": "Choreography", "amount": 275.0, "vendor": "Elite Stars Allstars", "due_date": str(today + timedelta(days=12)),
          "person": "Ava Johnson", "note": "Spring choreo camp"}),
        ("payment", "email", "Payment · $150 to Elite Stars Allstars",
         {"amount": 150.0, "method": "card", "person": "Mia Johnson", "paid_on": str(today - timedelta(days=1)),
          "payee": "Elite Stars Allstars", "note": "October tuition"}),
    ]:
        await _insert(db, "inbox_drafts", server.InboxDraft(user_id=user_id, kind=kind, source=source, summary=summary, data=data))
    nat = await db.competitions.find_one({"user_id": user_id, "name": "Spirit Nationals"}, {"_id": 0, "id": 1, "event_date": 1})
    if nat:
        await _insert(db, "inbox_drafts", server.InboxDraft(
            user_id=user_id, kind="competition", source="email", summary="Competition day · Spirit Nationals",
            data={"name": "Spirit Nationals", "event_date": nat.get("event_date"), "performance_time": "10:45",
                  "meet_time": "09:00", "meeting_location": "Hall D lobby, by the team banner",
                  "what_to_wear": "Black warm-ups over full uniform; hair in curled high pony with red bow",
                  "spectator_fee": 30.0, "parking_fee": 20.0,
                  "teams_to_watch": [{"name": "Stingray Allstars Orange", "performance_time": "11:20"},
                                     {"name": "Cheer Extreme Senior Elite", "performance_time": "12:05"}],
                  "day_details": "• Warm-up check-in at 9:45 AM\n• Awards at 4:30 PM\n• Athletes enter through the athlete entrance only",
                  "matched_competition_id": nat["id"]}))

    # ---- SMS broadcast history with delivery receipts (no real texts are sent)
    bid = str(uuid.uuid4())
    sent_at = iso(datetime.now(timezone.utc) - timedelta(hours=20))
    msg = "Reminder: Summit rooming list + travel forms are due Friday. Thank you! 💙"
    await db.broadcasts.insert_one({
        "id": bid, "user_id": user_id, "created_by_name": DEMO_NAME, "message": msg, "body_trailer": "",
        "recipient_count": len(athletes), "sent": len(athletes), "failed": 0, "delivered": len(athletes),
        "undelivered": 0, "retried_count": 0, "failed_recipients": [], "failed_targets": [], "no_phone": [],
        "track_count": 0, "attachment_count": 0, "media_urls": [], "media_count": 0, "created_at": sent_at,
    })
    for i, (rid, name) in enumerate(athletes):
        await db.sms_messages.insert_one({
            "id": str(uuid.uuid4()), "broadcast_id": bid, "user_id": user_id, "member_name": f"{name} (Parent)",
            "phone": f"+1555010{i:04d}"[:12], "direction": "out", "attempts": 1, "sid": f"SMDEMO{i}",
            "status": "delivered", "error_code": None, "error_message": None, "created_at": sent_at, "updated_at": sent_at,
        })

    # ---- Community Reviews (global directory) — reviewers = owner, co-parent, coach
    places = [
        ("Gatorland Grill", "Orlando, FL", "Restaurants/Eateries",
         [(5, "Big tables for the whole team and they had our order out in 20 minutes. Kids loved it!"),
          (4, "Great wings, a little loud but perfect after awards.")]),
        ("Wyndham Lake Buena Vista", "Orlando, FL", "Hotels/Lodging",
         [(5, "Shuttle to the ESPN complex every 30 min — total lifesaver on comp weekend."),
          (4, "Clean rooms, pool was a hit. Ask for a high floor.")]),
        ("Glam Squad Cheer Hair & Makeup", "Kissimmee, FL", "Hair & Makeup Artists",
         [(5, "Competition makeup lasted all day under the arena lights. Booking again!")]),
        ("Bean There Coffee", "Kissimmee, FL", "Coffee Shops",
         [(5, "Opens at 5:30am — perfect for early call times. Great hot chocolate for the athletes.")]),
    ]
    authors = [(user_id, "Jordan J."), (coparent_id, "Taylor M."), (coach_id, "Casey R.")]
    for name, city, cat, revs in places:
        place = await db.review_places.find_one({"name_norm": name.lower(), "city_norm": city.lower()})
        pid = place["id"] if place else str(uuid.uuid4())
        if not place:
            await db.review_places.insert_one({
                "id": pid, "name": name, "name_norm": name.lower(), "city": city, "city_norm": city.lower(),
                "category": cat, "avg_rating": 0.0, "review_count": 0, "created_by": user_id,
                "created_at": now_iso(), "updated_at": now_iso(),
            })
        for (rating, body), (uid, author) in zip(revs, authors):
            if not uid:
                continue
            await db.place_reviews.delete_many({"place_id": pid, "user_id": uid})
            await db.place_reviews.insert_one({
                "id": str(uuid.uuid4()), "place_id": pid, "user_id": uid, "rating": rating, "body": body,
                "display_mode": "name", "author_name": author, "photos": [],
                "created_at": now_iso(), "updated_at": now_iso(),
            })
        rows = await db.place_reviews.find({"place_id": pid}, {"_id": 0, "rating": 1}).to_list(1000)
        await db.review_places.update_one({"id": pid}, {"$set": {
            "avg_rating": round(sum(r["rating"] for r in rows) / len(rows), 2), "review_count": len(rows)}})
    print("Seeded payments, sign-ups, paperwork, attendance, sizes, results, Smart Inbox, SMS history, reviews.")


if __name__ == "__main__":
    asyncio.run(run())
