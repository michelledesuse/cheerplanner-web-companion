from datetime import datetime as _dt, timedelta as _td

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import Household, HouseholdInvite, HouseholdJoinRequest, utcnow_iso
from core.security import get_current_user
from core.helpers import _get_or_create_household

router = APIRouter(prefix="/api")


@router.get("/household")
async def get_household(current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    members = []
    async for u in db.users.find({"id": {"$in": h["member_user_ids"]}}, {"_id": 0, "id": 1, "email": 1, "name": 1}):
        members.append(u)
    return {"id": h["id"], "members": members}


@router.post("/household/invite")
async def create_household_invite(current_user=Depends(get_current_user)):
    import secrets
    h = await _get_or_create_household(current_user["id"])
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no confusing 0/O/1/I
    code = "".join(secrets.choice(alphabet) for _ in range(6))
    expires = (_dt.utcnow() + _td(days=7)).isoformat() + "Z"
    invite = HouseholdInvite(
        household_id=h["id"],
        invited_by=current_user["id"],
        code=code,
        expires_at=expires,
    ).model_dump()
    await db.household_invites.insert_one(invite)
    return {"code": code, "expires_at": expires}


@router.post("/household/join")
async def join_household(payload: HouseholdJoinRequest, current_user=Depends(get_current_user)):
    code = payload.code.strip().upper()
    invite = await db.household_invites.find_one({"code": code, "used_at": None}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid or expired invite code")
    try:
        expires = _dt.fromisoformat(invite["expires_at"].replace("Z", ""))
        if expires < _dt.utcnow():
            raise HTTPException(status_code=400, detail="Invite code has expired")
    except (ValueError, KeyError):
        pass
    user_id = current_user["id"]
    if user_id == invite["invited_by"]:
        raise HTTPException(status_code=400, detail="You can't use your own invite code")
    # Remove user from current household (and delete household if empty)
    current_h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    if current_h and current_h["id"] != invite["household_id"]:
        new_members = [u for u in current_h["member_user_ids"] if u != user_id]
        if new_members:
            await db.households.update_one({"id": current_h["id"]}, {"$set": {"member_user_ids": new_members}})
        else:
            await db.households.delete_one({"id": current_h["id"]})
    # Add user to target household
    await db.households.update_one(
        {"id": invite["household_id"]},
        {"$addToSet": {"member_user_ids": user_id}},
    )
    # Mark invite as used
    await db.household_invites.update_one(
        {"id": invite["id"]}, {"$set": {"used_at": utcnow_iso()}}
    )
    return {"joined": True, "household_id": invite["household_id"]}


@router.post("/household/leave")
async def leave_household(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="No household")
    remaining = [u for u in h["member_user_ids"] if u != user_id]
    if remaining:
        await db.households.update_one({"id": h["id"]}, {"$set": {"member_user_ids": remaining}})
    else:
        await db.households.delete_one({"id": h["id"]})
    new_h = Household(member_user_ids=[user_id]).model_dump()
    await db.households.insert_one(new_h)
    return {"left": True, "new_household_id": new_h["id"]}
