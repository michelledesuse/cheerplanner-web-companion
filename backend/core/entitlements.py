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
from core.models import utcnow_iso, Entitlement
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

    Option C: the user's OWN lifetime/promo entitlements FOLLOW them to their
    current household (single active binding). We rebind lazily here so leaving
    a household reverts it to Free and joining a new one carries Premium.
    """
    h = await _get_or_create_household(user_id)
    hid = h["id"]
    res = await db.entitlements.update_many(
        {
            "user_id": user_id, "status": "active",
            "type": {"$in": ["lifetime", "promo", "subscription"]},
            "household_id": {"$ne": hid},
        },
        {"$set": {"household_id": hid, "updated_at": utcnow_iso()}},
    )
    if res.modified_count:
        await log_entitlement_event(
            action="rebound", entitlement_id=None, user_id=user_id, household_id=hid,
            meta={"rebound_count": res.modified_count},
        )
    status = await resolve_household_premium(hid)
    status["household_id"] = hid
    # For the "you already have Lifetime — your store sub may still renew" notice (#14).
    if status.get("plan") == "lifetime":
        sub = await db.entitlements.find_one(
            {"household_id": hid, "type": "subscription", "source": {"$in": ["apple", "google"]},
             "status": "active", "$or": [{"expires_at": None}, {"expires_at": {"$gt": utcnow_iso()}}]},
            {"_id": 0, "id": 1},
        )
        status["has_store_subscription"] = bool(sub)
    return status


# ------------------------------------------------------------------
# Grant / revoke
# ------------------------------------------------------------------
async def grant_lifetime(
    *, user_id: str, household_id: str, source: str,
    reason: Optional[str] = None, label: Optional[str] = None,
    note: Optional[str] = None, admin_id: Optional[str] = None,
) -> str:
    """Grant (or rebind) a Lifetime Premium entitlement for a user. Option C:
    one active lifetime per user, bound to their current household."""
    existing = await db.entitlements.find_one(
        {"user_id": user_id, "type": "lifetime", "status": "active"}, {"_id": 0}
    )
    if existing:
        await db.entitlements.update_one(
            {"id": existing["id"]},
            {"$set": {
                "household_id": household_id, "updated_at": utcnow_iso(),
                "reason": reason or existing.get("reason"),
                "label": label or existing.get("label"),
            }},
        )
        await log_entitlement_event(
            action="rebound", entitlement_id=existing["id"], user_id=user_id,
            household_id=household_id, source=source, reason=reason, label=label, admin_id=admin_id,
        )
        return existing["id"]

    ent = Entitlement(
        type="lifetime", source=source, user_id=user_id, household_id=household_id,
        plan="lifetime", reason=reason, label=label, note=note, granted_by_admin_id=admin_id,
    ).model_dump()
    await db.entitlements.insert_one(dict(ent))
    await log_entitlement_event(
        action="granted", entitlement_id=ent["id"], user_id=user_id, household_id=household_id,
        source=source, reason=reason, label=label, admin_id=admin_id,
    )
    return ent["id"]


async def revoke_entitlement(entitlement_id: str, *, admin_id: Optional[str] = None, reason: Optional[str] = None) -> bool:
    ent = await db.entitlements.find_one({"id": entitlement_id}, {"_id": 0})
    if not ent:
        return False
    await db.entitlements.update_one(
        {"id": entitlement_id}, {"$set": {"status": "revoked", "updated_at": utcnow_iso()}}
    )
    await log_entitlement_event(
        action="revoked", entitlement_id=entitlement_id, user_id=ent.get("user_id"),
        household_id=ent.get("household_id"), source=ent.get("source"), reason=reason, admin_id=admin_id,
    )
    return True


async def apply_subscription_event(
    *, user_id: str, plan: Optional[str], product_id: Optional[str],
    expires_at: Optional[str], active: bool, source: str = "apple",
    rc_id: Optional[str] = None, event_type: Optional[str] = None,
) -> str:
    """Upsert the user's store subscription entitlement (one per source), bound
    to their current household. Called from the RevenueCat webhook."""
    h = await _get_or_create_household(user_id)
    now = utcnow_iso()
    status = "active" if active else "expired"
    existing = await db.entitlements.find_one(
        {"user_id": user_id, "type": "subscription", "source": source}, {"_id": 0}
    )
    if existing:
        await db.entitlements.update_one(
            {"id": existing["id"]},
            {"$set": {
                "household_id": h["id"], "status": status, "plan": plan,
                "expires_at": expires_at, "store_txn_id": product_id,
                "revenuecat_id": rc_id, "updated_at": now,
            }},
        )
        eid = existing["id"]
    else:
        ent = Entitlement(
            type="subscription", source=source, user_id=user_id, household_id=h["id"],
            status=status, plan=plan, expires_at=expires_at, store_txn_id=product_id,
            revenuecat_id=rc_id,
        ).model_dump()
        await db.entitlements.insert_one(dict(ent))
        eid = ent["id"]
    await log_entitlement_event(
        action=("purchased" if active else "expired"), entitlement_id=eid,
        user_id=user_id, household_id=h["id"], source=source,
        meta={"event_type": event_type, "product_id": product_id, "expires_at": expires_at},
    )
    return eid


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
