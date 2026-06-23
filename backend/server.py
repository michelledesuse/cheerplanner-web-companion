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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
