"""Team Hub access delegation.

The household **owner** (main account holder) controls who can open the Team
Hub — replacing the old per-login self-toggle. The owner can grant/revoke
access for existing household members and invite new people by email (a
code-based invite that grants Team Hub access on join).
"""
import secrets
from datetime import datetime as _dt, timedelta as _td

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    HouseholdInvite,
    TeamAccessMemberPayload,
    TeamAccessInvitePayload,
)
from core.security import get_current_user
from core.helpers import _get_or_create_household, _household_owner_id

router = APIRouter(prefix="/api/team-access")


async def _require_owner(current_user) -> dict:
    """Return the household, ensuring the caller is its owner."""
    h = await _get_or_create_household(current_user["id"])
    if _household_owner_id(h) != current_user["id"]:
        raise HTTPException(status_code=403, detail="Only the account owner can manage Team Hub access")
    return h


@router.get("")
async def get_team_access(current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    owner_id = _household_owner_id(h)
    is_owner = owner_id == current_user["id"]

    members = []
    async for u in db.users.find(
        {"id": {"$in": h.get("member_user_ids", [])}},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "team_access": 1},
    ):
        members.append({
            "id": u["id"],
            "email": u.get("email"),
            "name": u.get("name"),
            "team_access": bool(u.get("team_access")),
            "is_owner": u["id"] == owner_id,
        })

    invites = []
    if is_owner:
        async for inv in db.household_invites.find(
            {"household_id": h["id"], "grant_team_access": True, "used_at": None},
            {"_id": 0, "id": 1, "email": 1, "code": 1, "expires_at": 1},
        ):
            invites.append(inv)

    return {
        "is_owner": is_owner,
        "owner_user_id": owner_id,
        "members": members,
        "invites": invites,
    }


@router.patch("/members/{user_id}")
async def set_member_access(user_id: str, payload: TeamAccessMemberPayload, current_user=Depends(get_current_user)):
    h = await _require_owner(current_user)
    if user_id not in (h.get("member_user_ids") or []):
        raise HTTPException(status_code=404, detail="That member isn't in your household")
    res = await db.users.update_one({"id": user_id}, {"$set": {"team_access": bool(payload.enabled)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"user_id": user_id, "team_access": bool(payload.enabled)}


@router.post("/invite")
async def invite_to_team(payload: TeamAccessInvitePayload, current_user=Depends(get_current_user)):
    h = await _require_owner(current_user)
    email = payload.email.lower().strip()

    # If the person is already a household member, grant directly.
    existing_user = await db.users.find_one({"email": email}, {"_id": 0, "id": 1})
    if existing_user and existing_user["id"] in (h.get("member_user_ids") or []):
        await db.users.update_one({"id": existing_user["id"]}, {"$set": {"team_access": True}})
        return {"granted": True, "user_id": existing_user["id"]}

    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no confusing 0/O/1/I
    code = "".join(secrets.choice(alphabet) for _ in range(6))
    expires = (_dt.utcnow() + _td(days=7)).isoformat() + "Z"
    invite = HouseholdInvite(
        household_id=h["id"],
        invited_by=current_user["id"],
        code=code,
        expires_at=expires,
        email=email,
        grant_team_access=True,
    ).model_dump()
    await db.household_invites.insert_one(invite)
    return {"invited": True, "code": code, "email": email, "expires_at": expires}


@router.delete("/invite/{invite_id}")
async def revoke_invite(invite_id: str, current_user=Depends(get_current_user)):
    h = await _require_owner(current_user)
    res = await db.household_invites.delete_one({"id": invite_id, "household_id": h["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"revoked": True}
