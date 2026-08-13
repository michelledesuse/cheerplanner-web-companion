import uuid
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.models import (
    UserSignup, UserLogin, UserPublic, TokenResponse, DeleteAccountPayload, TeamAccessPayload,
)
from core.security import (
    hash_password, verify_password, create_access_token, get_current_user, limiter,
)
from core.config import ADMIN_EMAILS
from core.models import utcnow_iso

router = APIRouter(prefix="/api")


@router.get("/")
async def root():
    return {"message": "CheerPlanner API", "ok": True}


@router.post("/auth/signup", response_model=TokenResponse)
@limiter.limit("10/minute")
async def signup(request: Request, payload: UserSignup):
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "created_at": utcnow_iso(),
        # Auto-flag admins from the ADMIN_EMAILS allowlist (server-side only).
        "is_admin": email in ADMIN_EMAILS,
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, email)
    return TokenResponse(
        access_token=token,
        user=UserPublic(id=user_id, email=email, name=payload.name, created_at=user_doc["created_at"], is_admin=user_doc["is_admin"], visibility={"expenses": True, "travel": True}),
    )


@router.post("/auth/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, payload: UserLogin):
    email = payload.email.lower().strip()
    user_doc = await db.users.find_one({"email": email})
    if not user_doc or not verify_password(payload.password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user_doc["id"], email)
    from core.helpers import _member_visibility
    visibility = await _member_visibility(user_doc["id"])
    return TokenResponse(
        access_token=token,
        user=UserPublic(
            id=user_doc["id"], email=email, name=user_doc.get("name"), created_at=user_doc["created_at"],
            team_access=bool(user_doc.get("team_access")),
            is_admin=bool(user_doc.get("is_admin")),
            visibility=visibility,
        ),
    )


@router.get("/auth/me", response_model=UserPublic)
async def me(current_user=Depends(get_current_user)):
    from core.helpers import _member_visibility
    visibility = await _member_visibility(current_user["id"])
    return UserPublic(
        id=current_user["id"],
        email=current_user["email"],
        name=current_user.get("name"),
        created_at=current_user["created_at"],
        team_access=bool(current_user.get("team_access")),
        is_admin=bool(current_user.get("is_admin")),
        visibility=visibility,
    )


@router.patch("/auth/team-access", response_model=UserPublic)
async def set_team_access(payload: TeamAccessPayload, current_user=Depends(get_current_user)):
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"team_access": payload.enabled}})
    return UserPublic(
        id=current_user["id"],
        email=current_user["email"],
        name=current_user.get("name"),
        created_at=current_user["created_at"],
        team_access=payload.enabled,
    )


@router.delete("/auth/me")
async def delete_account(payload: DeleteAccountPayload, current_user=Depends(get_current_user)):
    """Permanently delete the current user's account.

    Apple App Store Guideline 5.1.1(v): apps that support account creation
    must allow users to delete their account from within the app. We require
    password re-confirmation, then cascade-delete every collection scoped to
    this user. Records owned by surviving household co-members are preserved.
    """
    user_id = current_user["id"]
    user_doc = await db.users.find_one({"id": user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(payload.password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Password is incorrect")

    households = db.households.find({"member_user_ids": user_id})
    async for h in households:
        members = [m for m in (h.get("member_user_ids") or []) if m != user_id]
        if members:
            await db.households.update_one({"id": h["id"]}, {"$set": {"member_user_ids": members}})
        else:
            await db.households.delete_one({"id": h["id"]})

    # Remove the user from any Team Hub they collaborate on (not a household member).
    await db.households.update_many(
        {"team_hub_member_user_ids": user_id},
        {"$pull": {"team_hub_member_user_ids": user_id}},
    )
    # Clean up any entitlements the user owned (Premium reverts for their household).
    await db.entitlements.delete_many({"user_id": user_id})

    collections_to_purge = [
        "athletes", "competitions", "bookings", "expenses", "payments",
        "fundraisers", "schedule_events", "packing_templates", "packing_lists",
        "teams",
    ]
    deleted_counts: Dict[str, int] = {}
    for name in collections_to_purge:
        res = await db[name].delete_many({"user_id": user_id})
        deleted_counts[name] = res.deleted_count

    invite_res = await db.household_invites.delete_many({"invited_by": user_id})
    deleted_counts["household_invites"] = invite_res.deleted_count

    await db.users.delete_one({"id": user_id})

    return {
        "deleted": True,
        "user_id": user_id,
        "purged": deleted_counts,
    }
