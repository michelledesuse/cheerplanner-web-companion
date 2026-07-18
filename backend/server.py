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
):
    app.include_router(r)


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
