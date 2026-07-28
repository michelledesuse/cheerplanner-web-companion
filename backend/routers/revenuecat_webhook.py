"""RevenueCat webhook — Apple IAP subscription source of truth sync (Phase 2).

RevenueCat notifies us of subscription lifecycle events; we translate them into
our household-bound `subscription` entitlement so the central resolver stays the
single source of truth. Verified via the Authorization header shared secret.
Idempotent via `rc_processed_events`.

Lifecycle rules (per RevenueCat docs):
  INITIAL_PURCHASE / RENEWAL / UNCANCELLATION / PRODUCT_CHANGE  -> active
  BILLING_ISSUE with grace period                              -> keep active until grace end
  CANCELLATION                                                 -> keep access until expiry (no-op)
  EXPIRATION                                                   -> revoke
"""
import hmac
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request, Header, HTTPException

from core.db import db
from core.config import REVENUECAT_WEBHOOK_AUTH
from core.plans import PRODUCT_PLAN_MAP
from core.entitlements import apply_subscription_event

logger = logging.getLogger("cheerplanner")
router = APIRouter(prefix="/api/webhooks")

GRANT_EVENTS = {"INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE"}
EXPIRE_EVENTS = {"EXPIRATION"}


def _ms_to_iso(ms: Optional[int]) -> Optional[str]:
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat()
    except Exception:
        return None


@router.post("/revenuecat")
async def revenuecat_webhook(request: Request, authorization: Optional[str] = Header(default=None)):
    # Verify shared secret (constant-time). If unset, refuse (fail closed).
    if not REVENUECAT_WEBHOOK_AUTH or not authorization or not hmac.compare_digest(authorization, REVENUECAT_WEBHOOK_AUTH):
        raise HTTPException(status_code=401, detail="unauthorized")

    body = await request.json()
    event = body.get("event") or {}
    event_id = event.get("id")
    event_type = event.get("type")
    app_user_id = event.get("app_user_id") or event.get("original_app_user_id")
    if not event_id or not app_user_id:
        return {"ok": True}

    # Idempotency: skip if we've already handled this event.
    if await db.rc_processed_events.find_one({"_id": event_id}):
        return {"ok": True}
    await db.rc_processed_events.insert_one({"_id": event_id, "type": event_type})

    # Map RevenueCat app_user_id -> our user. (We set appUserID = our user_id.)
    user = await db.users.find_one({"id": app_user_id}, {"_id": 0, "id": 1})
    if not user:
        logger.warning(f"RevenueCat event for unknown app_user_id={app_user_id}")
        return {"ok": True}

    product_id = event.get("product_id")
    plan = PRODUCT_PLAN_MAP.get(product_id or "", None)
    expiration = _ms_to_iso(event.get("expiration_at_ms"))
    grace = _ms_to_iso(event.get("grace_period_expiration_at_ms"))
    # Prefer the later of expiration / grace for the access window.
    access_expires = max([x for x in [expiration, grace] if x], default=None)

    active = False
    if event_type in GRANT_EVENTS:
        active = True
    elif event_type == "BILLING_ISSUE":
        active = bool(grace)  # keep access only while in grace
    elif event_type in EXPIRE_EVENTS:
        active = False
    elif event_type == "CANCELLATION":
        # User cancelled auto-renew; access continues until EXPIRATION. No change.
        return {"ok": True}
    else:
        # Unknown/other event types: no entitlement change.
        return {"ok": True}

    await apply_subscription_event(
        user_id=user["id"], plan=plan, product_id=product_id,
        expires_at=access_expires, active=active, source="apple",
        rc_id=event_id, event_type=event_type,
    )
    return {"ok": True}
