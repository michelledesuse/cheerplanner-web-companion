"""Lifetime Premium code redemption (requirement #9, #15, #17).

Redemption is server-side only and validated against a hashed, single-use code
with an ATOMIC claim (find_one_and_update) to defeat races. Errors are generic
so codes cannot be enumerated. Rate-limited to blunt brute-force guessing.

This endpoint backs the Apple-compliant WEB redemption portal (1c). The mobile
app never shows a code-entry field; it only READS the resulting entitlement.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument

from core.db import db
from core.models import RedeemPayload, utcnow_iso
from core.security import get_current_user, code_hash, limiter
from core.helpers import _get_or_create_household
from core.entitlements import grant_lifetime, log_entitlement_event, get_household_premium

router = APIRouter(prefix="/api/premium")


@router.get("/status")
async def premium_status(current_user=Depends(get_current_user)):
    return await get_household_premium(current_user["id"])


@router.post("/redeem")
@limiter.limit("5/minute")
async def redeem_code(request: Request, payload: RedeemPayload, current_user=Depends(get_current_user)):
    now = utcnow_iso()
    digest = code_hash(payload.code)

    # Atomic single-use claim; expiry folded into the filter so no rollback needed.
    claimed = await db.lifetime_codes.find_one_and_update(
        {
            "code_hash": digest, "status": "available",
            "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}],
        },
        {"$set": {
            "status": "redeemed",
            "redeemed_by_user_id": current_user["id"],
            "redeemed_at": now,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        # Generic error: invalid / used / disabled / revoked / expired all look identical.
        raise HTTPException(status_code=400, detail="Invalid or already-used code")

    h = await _get_or_create_household(current_user["id"])
    ent_id = await grant_lifetime(
        user_id=current_user["id"], household_id=h["id"], source="code_redemption",
        reason=claimed.get("label"), label=claimed.get("label"),
        note=f"code:{claimed.get('id')}",
    )
    await db.lifetime_codes.update_one(
        {"id": claimed["id"]},
        {"$set": {"redeemed_household_id": h["id"], "entitlement_id": ent_id}},
    )
    await log_entitlement_event(
        action="redeemed", entitlement_id=ent_id, user_id=current_user["id"],
        household_id=h["id"], source="code_redemption", label=claimed.get("label"),
        meta={"code_id": claimed.get("id")},
    )
    return {"redeemed": True, "plan": "lifetime"}
