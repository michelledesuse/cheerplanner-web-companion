"""Team Hub switcher.

A "hub" is a team, represented by the household of the rep/manager who owns it.
Coaches are invited to multiple hubs (via Team Hub Access); these endpoints let
them list the hubs they can access, switch the active hub, and rename a hub they
own. The active hub is stored on the user (`active_hub_id`) and drives all Team
Hub data scoping (see core.helpers._resolve_active_household).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.db import db
from core.security import get_current_user
from core.helpers import _accessible_hubs, _resolve_active_household

router = APIRouter(prefix="/api/team/hubs", tags=["team-hubs"])


class SetActivePayload(BaseModel):
    hub_id: str


class RenameHubPayload(BaseModel):
    name: str


async def _owner_name(owner_id: Optional[str]) -> str:
    if not owner_id:
        return "Team Hub"
    u = await db.users.find_one({"id": owner_id}, {"_id": 0, "name": 1, "first_name": 1, "last_name": 1})
    if not u:
        return "Team Hub"
    nm = (u.get("name") or f"{u.get('first_name') or ''} {u.get('last_name') or ''}").strip()
    first = nm.split(" ")[0] if nm else ""
    return f"{first}'s Team" if first else "Team Hub"


@router.get("")
async def list_hubs(current_user=Depends(get_current_user)):
    uid = current_user["id"]
    hubs = await _accessible_hubs(uid)
    active = await _resolve_active_household(uid)
    active_id = active["id"] if active else None
    out = []
    for h in hubs:
        owner_id = h.get("owner_user_id")
        name = h.get("hub_name") or await _owner_name(owner_id)
        out.append({
            "id": h["id"],
            "name": name,
            "is_owner": owner_id == uid,
            "is_active": h["id"] == active_id,
        })
    return {"hubs": out, "active_hub_id": active_id}


@router.post("/active")
async def set_active_hub(payload: SetActivePayload, current_user=Depends(get_current_user)):
    uid = current_user["id"]
    hubs = await _accessible_hubs(uid)
    if not any(h["id"] == payload.hub_id for h in hubs):
        raise HTTPException(status_code=403, detail="You don't have access to that hub")
    await db.users.update_one({"id": uid}, {"$set": {"active_hub_id": payload.hub_id}})
    return {"active_hub_id": payload.hub_id}


@router.patch("/{hub_id}")
async def rename_hub(hub_id: str, payload: RenameHubPayload, current_user=Depends(get_current_user)):
    uid = current_user["id"]
    h = await db.households.find_one({"id": hub_id}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Hub not found")
    if h.get("owner_user_id") != uid:
        raise HTTPException(status_code=403, detail="Only the hub owner can rename this hub")
    name = (payload.name or "").strip()[:60]
    await db.households.update_one({"id": hub_id}, {"$set": {"hub_name": name or None}})
    return {"id": hub_id, "name": name}
