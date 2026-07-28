"""Privacy-conscious Premium analytics (Phase 3).

We record ONLY anonymous product events (no names, emails, or cheer-family
content) so we can understand Free->Premium conversion. Each event stores an
event name, optional non-sensitive props (e.g. which plan/feature), the user &
household id (for de-duped conversion funnels), platform, and timestamp.
"""
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends

from core.db import db
from core.models import utcnow_iso
from core.security import get_current_user, require_admin
from core.helpers import _get_or_create_household

router = APIRouter(prefix="/api/analytics")

# Only these event names are accepted (allowlist prevents accidental PII capture).
ALLOWED_EVENTS = {
    "paywall_view", "upgrade_tap", "plan_selected", "trial_start",
    "purchase_success", "restore_tap", "feature_gate_hit", "code_redeemed",
}
# Only these prop keys are stored (everything else is dropped).
ALLOWED_PROP_KEYS = {"plan", "feature", "platform", "source"}


@router.post("/event")
async def track_event(payload: Dict[str, Any], current_user=Depends(get_current_user)):
    name = str(payload.get("name") or "")
    if name not in ALLOWED_EVENTS:
        return {"ok": False, "ignored": True}
    raw_props = payload.get("props") or {}
    props = {k: str(v)[:64] for k, v in raw_props.items() if k in ALLOWED_PROP_KEYS}
    h = await _get_or_create_household(current_user["id"])
    await db.analytics_events.insert_one({
        "name": name,
        "props": props,
        "user_id": current_user["id"],
        "household_id": h["id"],
        "at": utcnow_iso(),
    })
    return {"ok": True}


@router.get("/summary", dependencies=[Depends(require_admin)])
async def analytics_summary(admin=Depends(require_admin)):
    """Admin funnel snapshot — pure counts, no personal data."""
    # Event counts by name.
    by_name = {}
    async for row in db.analytics_events.aggregate([{"$group": {"_id": "$name", "n": {"$sum": 1}}}]):
        by_name[row["_id"]] = row["n"]

    # Which locked features drive the most upgrade interest.
    gate_by_feature = {}
    async for row in db.analytics_events.aggregate([
        {"$match": {"name": "feature_gate_hit"}},
        {"$group": {"_id": "$props.feature", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
    ]):
        gate_by_feature[row["_id"] or "unknown"] = row["n"]

    # Plan selection split (monthly vs annual).
    plan_split = {}
    async for row in db.analytics_events.aggregate([
        {"$match": {"name": "plan_selected"}},
        {"$group": {"_id": "$props.plan", "n": {"$sum": 1}}},
    ]):
        plan_split[row["_id"] or "unknown"] = row["n"]

    # Entitlement outcomes (source of truth = entitlements collection).
    premium_households = len(await db.entitlements.distinct("household_id", {"status": "active"}))
    lifetime_grants = await db.entitlements.count_documents({"type": "lifetime", "status": "active"})
    active_subs = await db.entitlements.count_documents({"type": "subscription", "status": "active"})
    codes_redeemed = await db.lifetime_codes.count_documents({"status": "redeemed"})

    return {
        "events": by_name,
        "feature_gate_hits": gate_by_feature,
        "plan_selected": plan_split,
        "premium_households": premium_households,
        "lifetime_active": lifetime_grants,
        "subscriptions_active": active_subs,
        "codes_redeemed": codes_redeemed,
    }
