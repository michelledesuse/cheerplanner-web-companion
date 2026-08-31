"""CheerPlanner FastAPI app.

This module is intentionally thin: it wires the FastAPI app, middleware,
startup/shutdown hooks, and includes the modular routers defined in
`routers/`. All business logic lives in `routers/*.py` and shared utilities
live in `core/*.py`.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from core.db import client, db
from core.security import limiter
from core.scheduler import start_scheduler, stop_scheduler
from routers import (
    auth,
    teams,
    athletes,
    expenses,
    payments,
    competitions,
    bookings,
    calendar,
    fundraisers,
    reminders,
    dashboard,
    imports as imports_router,
    schedule,
    household,
    exports,
    packing,
    bulk,
    notifications,
    password_reset,
    roster,
    team_payments,
    sizes,
    paperwork,
    signups,
    team_access,
    hubs,
    share,
    scouting,
    todos,
    attendance,
    blocks,
    entitlements,
    admin,
    premium,
    revenuecat_webhook,
    analytics,
    realtime,
    seasons,
    music,
    broadcast,
    twilio_hooks,
    roadmap,
    team_forms,
    reviews,
    weather,
    activity,
    team_chat,
    team_members,
)


# ---------- Logging ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# ---------- App ----------
app = FastAPI(title="CheerPlanner API")
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests, slow down."})


# ---------- Wire routers (all prefixed with /api inside each router) ----------
for r in (
    auth.router,
    teams.router,
    athletes.router,
    expenses.router,
    payments.router,
    competitions.router,
    bookings.router,
    calendar.router,
    fundraisers.router,
    reminders.router,
    dashboard.router,
    imports_router.router,
    schedule.router,
    household.router,
    exports.router,
    packing.router,
    bulk.router,
    notifications.router,
    password_reset.router,
    roster.router,
    team_payments.router,
    sizes.router,
    paperwork.router,
    signups.router,
    team_access.router,
    hubs.router,
    share.router,
    scouting.router,
    todos.router,
    attendance.router,
    blocks.router,
    entitlements.router,
    admin.router,
    premium.router,
    revenuecat_webhook.router,
    analytics.router,
    realtime.router,
    seasons.router,
    music.router,
    broadcast.router,
    twilio_hooks.router,
    roadmap.router,
    team_forms.router,
    reviews.router,
    weather.router,
    activity.router,
    team_chat.router,
    team_members.router,):
    app.include_router(r)


# ---------- Real-time broadcast (W3) ----------
_RT_EXCLUDE = ("/api/ws", "/api/webhooks", "/api/analytics", "/api/auth")


@app.middleware("http")
async def realtime_broadcast(request: Request, call_next):
    response = await call_next(request)
    try:
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
            path = request.url.path
            if path.startswith("/api") and not any(path.startswith(p) for p in _RT_EXCLUDE):
                from core.realtime import manager, rooms_for_user, _user_from_auth_header
                user = await _user_from_auth_header(request.headers.get("authorization"))
                if user:
                    rooms = await rooms_for_user(user["id"])
                    await manager.broadcast(rooms, {"type": "invalidate", "path": path})
    except Exception:
        pass
    return response


# ---------- CORS ----------
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Startup / Shutdown hooks ----------
@app.on_event("startup")
async def startup_db_client():
    # Warm up Object Storage (chat media). Non-fatal if it can't reach the proxy.
    try:
        from core.storage import init_storage
        from starlette.concurrency import run_in_threadpool
        await run_in_threadpool(init_storage)
    except Exception as _e:  # noqa: BLE001
        logging.getLogger("startup").warning("storage init deferred: %s", _e)
    # One-time backfill: ensure expenses with missing/null due_date inherit incurred_on
    try:
        cursor = db.expenses.find(
            {"$or": [{"due_date": None}, {"due_date": ""}, {"due_date": {"$exists": False}}]},
            {"_id": 0, "id": 1, "incurred_on": 1},
        )
        backfilled = 0
        async for e in cursor:
            if e.get("incurred_on"):
                await db.expenses.update_one(
                    {"id": e["id"]}, {"$set": {"due_date": e["incurred_on"]}}
                )
                backfilled += 1
        if backfilled:
            logger.info(f"Startup backfill: due_date set on {backfilled} expense(s)")
    except Exception as exc:
        logger.warning(f"Startup backfill skipped: {exc}")

    # Idempotency index for digest email dedupe.
    try:
        await db.sent_notifications.create_index("key", unique=True)
    except Exception as exc:
        logger.warning(f"Could not create sent_notifications index: {exc}")

    # Team Music (Team Hub) indexes.
    try:
        await db.team_music.create_index("user_id")
        await db.music_chunks.create_index([("track_id", 1), ("index", 1)], unique=True)
    except Exception as exc:
        logger.warning(f"Could not create team_music indexes: {exc}")

    # Premium entitlements (Phase 0) — indexes for the resolver + audit trail.
    try:
        await db.entitlements.create_index("household_id")
        await db.entitlements.create_index("user_id")
        await db.entitlements.create_index([("type", 1), ("status", 1)])
        await db.entitlement_events.create_index("household_id")
        await db.entitlement_events.create_index("user_id")
        await db.lifetime_codes.create_index("code_hash", unique=True)
        await db.lifetime_codes.create_index("status")
        await db.analytics_events.create_index("name")
        await db.analytics_events.create_index("at")
    except Exception as exc:
        logger.warning(f"Could not create entitlement indexes: {exc}")

    # Community roadmap — one vote per user per item.
    try:
        await db.roadmap_votes.create_index([("item_id", 1), ("user_id", 1)], unique=True)
        await db.roadmap_votes.create_index("user_id")
        await db.roadmap_items.create_index("type")
        await db.roadmap_comments.create_index("item_id")
        await db.roadmap_notifications.create_index([("user_id", 1), ("seen", 1)])
        await db.team_forms.create_index("user_id")
        await db.team_form_responses.create_index([("form_id", 1), ("member_id", 1)])
        await db.household_activity.create_index([("household_id", 1), ("created_at", -1)])
        await db.household_activity.create_index("seen_by")
        await db.team_messages.create_index([("household_id", 1), ("created_at", -1)])
        await db.chat_reads.create_index([("household_id", 1), ("user_id", 1)], unique=True)
        await db.athlete_chat_links.create_index([("household_id", 1), ("roster_id", 1)], unique=True)
        await db.chat_media.create_index("id", unique=True)
    except Exception as exc:
        logger.warning(f"Could not create roadmap indexes: {exc}")

    # Community reviews — global cross-account place directory.
    try:
        await db.place_reviews.create_index([("place_id", 1), ("user_id", 1)], unique=True)
        await db.place_reviews.create_index("place_id")
        await db.review_places.create_index([("name_norm", 1), ("city_norm", 1)])
        await db.review_places.create_index("category")
        await db.review_categories.create_index("label_norm", unique=True)
        await db.review_flags.create_index([("review_id", 1), ("user_id", 1)], unique=True)
        await db.review_blocks.create_index([("user_id", 1), ("blocked_user_id", 1)], unique=True)
        from routers.reviews import seed_review_categories
        await seed_review_categories()
    except Exception as exc:
        logger.warning(f"Could not create review indexes: {exc}")

    # Weather caches — auto-expire via TTL so they stay fresh + bounded.
    try:
        await db.weather_geocache.create_index("expiresAt", expireAfterSeconds=0)
        await db.weather_forecastcache.create_index("expiresAt", expireAfterSeconds=0)
    except Exception as exc:
        logger.warning(f"Could not create weather indexes: {exc}")

    # Phase 1 — seed admin accounts from ADMIN_EMAILS (idempotent).
    try:
        from core.security import seed_admins
        await seed_admins()
    except Exception as exc:
        logger.warning(f"Could not seed admins: {exc}")

    # One-time (idempotent) migration: split legacy multi-day events into a
    # per-day series so each day is independently editable. Converted docs get
    # end_date cleared, so they are never re-processed.
    try:
        from core.helpers import _date_range
        import uuid as _uuid
        cursor = db.schedule_events.find({"end_date": {"$nin": [None, ""]}}, {"_id": 0})
        split_count = 0
        async for ev in cursor:
            start, end = ev.get("date"), ev.get("end_date")
            if not (start and end and end > start):
                if end and start and end <= start:
                    await db.schedule_events.update_one({"id": ev["id"]}, {"$set": {"end_date": None}})
                continue
            dates = _date_range(start, end)
            series_id = ev.get("series_id") or str(_uuid.uuid4())
            await db.schedule_events.update_one(
                {"id": ev["id"]},
                {"$set": {"end_date": None, "series_id": series_id, "date": dates[0]}},
            )
            clones = []
            for d in dates[1:]:
                clone = {k: v for k, v in ev.items() if k != "_id"}
                clone.update({"id": str(_uuid.uuid4()), "date": d, "end_date": None, "series_id": series_id})
                clones.append(clone)
            if clones:
                await db.schedule_events.insert_many(clones)
            split_count += 1
        if split_count:
            logger.info(f"Startup migration: split {split_count} multi-day event(s) into per-day series")
    except Exception as exc:
        logger.warning(f"Startup multi-day split skipped: {exc}")

    # Start the digest scheduler.
    try:
        start_scheduler()
    except Exception as exc:
        logger.exception("Failed to start scheduler: %s", exc)


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        stop_scheduler()
    except Exception:
        pass
    client.close()
