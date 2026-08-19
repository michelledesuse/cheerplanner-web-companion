"""Admin system for Premium administration (requirement #10, #11, #18).

Admin-only (guarded by require_admin — set server-side from ADMIN_EMAILS).
Lets the operator: look up users/households + their Premium status/source,
grant Lifetime directly, generate/list/disable Lifetime codes, view the audit
trail, and (for testing) toggle their own household Premium.
"""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core.db import db
from core.models import (
    LifetimeGrantPayload, CodeGeneratePayload, RevokePayload, AdminSelfPremiumPayload,
    utcnow_iso,
)
from core.security import require_admin, code_hash
from core.helpers import _get_or_create_household
from core.entitlements import (
    resolve_household_premium, grant_lifetime, revoke_entitlement, log_entitlement_event,
)

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


@router.get("/status")
async def admin_status(admin=Depends(require_admin)):
    return {"is_admin": True, "email": admin.get("email")}


@router.get("/flags/count")
async def flags_count(admin=Depends(require_admin)):
    """Outstanding moderation reports for the Admin badge (reviews + chat)."""
    rev = await db.review_flags.distinct("review_id")
    chat = await db.chat_message_flags.distinct("message_id")
    return {"reviews": len(rev), "chat": len(chat), "total": len(rev) + len(chat)}



async def _household_for_user(user_id: str) -> dict:
    return await _get_or_create_household(user_id)


@router.get("/users/search")
async def search_users(q: str = Query("", min_length=0), admin=Depends(require_admin)):
    """Search users by email or name; return each with resolved Premium status."""
    query = {}
    if q.strip():
        query = {"$or": [
            {"email": {"$regex": q.strip(), "$options": "i"}},
            {"name": {"$regex": q.strip(), "$options": "i"}},
        ]}
    out = []
    async for u in db.users.find(query, {"_id": 0, "id": 1, "email": 1, "name": 1, "is_admin": 1}).limit(25):
        h = await _get_or_create_household(u["id"])
        status = await resolve_household_premium(h["id"])
        out.append({
            "user_id": u["id"], "email": u.get("email"), "name": u.get("name"),
            "is_admin": bool(u.get("is_admin")),
            "household_id": h["id"],
            "household_member_count": len(h.get("member_user_ids") or []),
            "premium": status,
        })
    return {"results": out}


@router.get("/users/{user_id}/entitlements")
async def user_entitlements(user_id: str, admin=Depends(require_admin)):
    h = await _get_or_create_household(user_id)
    ents = await db.entitlements.find(
        {"$or": [{"user_id": user_id}, {"household_id": h["id"]}]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    events = await db.entitlement_events.find(
        {"$or": [{"user_id": user_id}, {"household_id": h["id"]}]}, {"_id": 0}
    ).sort("at", -1).to_list(200)
    return {
        "household_id": h["id"],
        "premium": await resolve_household_premium(h["id"]),
        "entitlements": ents,
        "events": events,
    }


@router.post("/lifetime/grant")
async def admin_grant_lifetime(payload: LifetimeGrantPayload, admin=Depends(require_admin)):
    user = None
    if payload.user_id:
        user = await db.users.find_one({"id": payload.user_id}, {"_id": 0, "id": 1, "email": 1})
    elif payload.email:
        user = await db.users.find_one({"email": payload.email.lower().strip()}, {"_id": 0, "id": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="No CheerPlanner account found for that user")
    h = await _get_or_create_household(user["id"])
    ent_id = await grant_lifetime(
        user_id=user["id"], household_id=h["id"], source="admin_grant",
        reason=payload.reason, label=payload.label or payload.reason, note=payload.note,
        admin_id=admin["id"],
    )
    return {
        "granted": True, "entitlement_id": ent_id,
        "user_id": user["id"], "email": user.get("email"), "household_id": h["id"],
    }


@router.post("/lifetime/revoke")
async def admin_revoke(payload: RevokePayload, admin=Depends(require_admin)):
    ok = await revoke_entitlement(payload.entitlement_id, admin_id=admin["id"], reason=payload.reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Entitlement not found")
    return {"revoked": True}


@router.get("/lifetime")
async def list_lifetime(admin=Depends(require_admin)):
    """Every account with ACTIVE Lifetime access — for the admin panel list.
    Includes who has it (name/email), when granted, source/label, and the
    entitlement_id needed to revoke."""
    out = []
    ents = await db.entitlements.find(
        {"type": "lifetime", "status": "active"}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    for e in ents:
        u = await db.users.find_one({"id": e.get("user_id")}, {"_id": 0, "email": 1, "name": 1})
        out.append({
            "entitlement_id": e.get("id"),
            "user_id": e.get("user_id"),
            "email": (u or {}).get("email"),
            "name": (u or {}).get("name"),
            "household_id": e.get("household_id"),
            "source": e.get("source"),
            "label": e.get("label") or e.get("reason"),
            "granted_at": e.get("created_at"),
        })
    return {"count": len(out), "lifetime": out}


@router.post("/codes/generate")
async def generate_codes(payload: CodeGeneratePayload, admin=Depends(require_admin)):
    """Generate N unique single-use Lifetime codes. Plaintext is returned ONCE
    for distribution; only the sha256 hash + last4 are stored."""
    created = []
    for _ in range(payload.count):
        plaintext = secrets.token_urlsafe(9).replace("_", "").replace("-", "")[:12].upper()
        # ensure decent length even after stripping
        while len(plaintext) < 10:
            plaintext += secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        digest = code_hash(plaintext)
        doc = {
            "id": secrets.token_hex(8),
            "code_hash": digest,
            "last4": plaintext[-4:],
            "status": "available",
            "label": payload.label,
            "note": payload.note,
            "expires_at": payload.expires_at,
            "created_by_admin_id": admin["id"],
            "created_at": utcnow_iso(),
            "redeemed_by_user_id": None,
            "redeemed_household_id": None,
            "redeemed_at": None,
            "entitlement_id": None,
        }
        try:
            await db.lifetime_codes.insert_one(doc)
        except Exception:
            continue  # extremely rare hash collision; skip
        created.append({"code": plaintext, "id": doc["id"], "last4": doc["last4"]})
    return {"created": created, "count": len(created)}


@router.get("/codes")
async def list_codes(status: Optional[str] = None, admin=Depends(require_admin)):
    query = {}
    if status:
        query["status"] = status
    codes = await db.lifetime_codes.find(
        query, {"_id": 0, "code_hash": 0}
    ).sort("created_at", -1).to_list(500)
    # attach redeemer email for redeemed codes
    for c in codes:
        if c.get("redeemed_by_user_id"):
            u = await db.users.find_one({"id": c["redeemed_by_user_id"]}, {"_id": 0, "email": 1})
            c["redeemed_by_email"] = (u or {}).get("email")
    return {"codes": codes}


@router.post("/codes/{code_id}/disable")
async def disable_code(code_id: str, admin=Depends(require_admin)):
    res = await db.lifetime_codes.update_one(
        {"id": code_id, "status": "available"}, {"$set": {"status": "disabled"}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Code not found or not disableable")
    return {"disabled": True}


@router.post("/codes/{code_id}/enable")
async def enable_code(code_id: str, admin=Depends(require_admin)):
    res = await db.lifetime_codes.update_one(
        {"id": code_id, "status": "disabled"}, {"$set": {"status": "available"}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Code not found or not enableable")
    return {"enabled": True}


@router.post("/self-premium-toggle")
async def self_premium_toggle(payload: AdminSelfPremiumPayload, admin=Depends(require_admin)):
    """TESTING ONLY: flip the admin's OWN household between Free and Premium so
    both experiences can be previewed. Uses a clearly-labeled test lifetime grant."""
    h = await _get_or_create_household(admin["id"])
    if payload.enabled:
        ent_id = await grant_lifetime(
            user_id=admin["id"], household_id=h["id"], source="admin_test",
            reason="Admin test toggle", label="Admin test", admin_id=admin["id"],
        )
        return {"enabled": True, "entitlement_id": ent_id}
    # disable: revoke the admin's active entitlements bound to this household
    ents = await db.entitlements.find(
        {"user_id": admin["id"], "status": "active"}, {"_id": 0, "id": 1}
    ).to_list(50)
    for e in ents:
        await revoke_entitlement(e["id"], admin_id=admin["id"], reason="Admin test toggle off")
    return {"enabled": False, "revoked": len(ents)}
