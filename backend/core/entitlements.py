"""Central Premium entitlement resolution + audit (requirement #8, #19, #23).

The rest of the app NEVER asks "does this user have an Apple subscription?".
It asks only: `is this household Premium?` via `get_household_premium(...)`.
Premium can come from any source (subscription, lifetime, promo, ...) and new
sources can be added later without changing a single feature check.

Collections:
  - entitlements        : one doc per granted entitlement (append, never overwrite a bool)
  - entitlement_events  : append-only audit trail of every entitlement change
"""
from typing import Dict, Any, List, Optional
import uuid

from core.db import db
from core.models import utcnow_iso
from core.helpers import _get_or_create_household


# ------------------------------------------------------------------
# Resolver
# ------------------------------------------------------------------
async def resolve_household_premium(household_id: str) -> Dict[str, Any]:
    """Resolve the current Premium status for a household.

    Priority: active Lifetime > active (non-expired) Subscription > active Promo > Free.
    Returns a dict the feature layer can trust: {is_premium, plan, source, expires_at, entitlement_id}.
    """
    now = utcnow_iso()

    life = await db.entitlements.find_one(
        {"type": "lifetime", "status": "active", "household_id": household_id},
        {"_id": 0},
    )
    if life:
        return {
            "is_premium": True, "plan": "lifetime", "source": life.get("source"),
            "expires_at": None, "entitlement_id": life.get("id"),
        }

    sub = await db.entitlements.find_one(
        {
            "type": "subscription", "status": "active", "household_id": household_id,
            "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}],
        },
        {"_id": 0},
        sort=[("expires_at", -1)],
    )
    if sub:
        return {
            "is_premium": True, "plan": sub.get("plan"), "source": sub.get("source"),
            "expires_at": sub.get("expires_at"), "entitlement_id": sub.get("id"),
        }

    promo = await db.entitlements.find_one(
        {
            "type": "promo", "status": "active", "household_id": household_id,
            "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}],
        },
        {"_id": 0},
    )
    if promo:
        return {
            "is_premium": True, "plan": "promo", "source": promo.get("source"),
            "expires_at": promo.get("expires_at"), "entitlement_id": promo.get("id"),
        }

    return {"is_premium": False, "plan": "free", "source": None, "expires_at": None, "entitlement_id": None}


async def get_household_premium(user_id: str) -> Dict[str, Any]:
    """Convenience: resolve premium for the household the user belongs to.

    Also returns household_id + whether a redundant subscription exists (for
    the "you already have Lifetime but a paid sub is still active" notice).
    """
    h = await _get_or_create_household(user_id)
    status = await resolve_household_premium(h["id"])
    status["household_id"] = h["id"]
    return status


# ------------------------------------------------------------------
# Audit trail (requirement #19)
# ------------------------------------------------------------------
async def log_entitlement_event(
    *,
    action: str,               # granted|redeemed|revoked|expired|rebound|purchased|renewed|notice
    entitlement_id: Optional[str],
    user_id: Optional[str],
    household_id: Optional[str],
    source: Optional[str] = None,
    reason: Optional[str] = None,
    label: Optional[str] = None,
    admin_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    await db.entitlement_events.insert_one({
        "id": str(uuid.uuid4()),
        "action": action,
        "entitlement_id": entitlement_id,
        "user_id": user_id,
        "household_id": household_id,
        "source": source,
        "reason": reason,
        "label": label,
        "admin_id": admin_id,
        "meta": meta or {},
        "at": utcnow_iso(),
    })
