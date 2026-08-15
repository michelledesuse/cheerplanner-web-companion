"""Household activity feed endpoints (Home-tab "new/updated items" banner)."""
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends

from core.db import db
from core.security import get_current_user
from core.helpers import _get_or_create_household

router = APIRouter(prefix="/api")


@router.get("/activity")
async def list_activity(current_user=Depends(get_current_user)):
    """Unseen activity by OTHER members in this user's household. Collapsed to
    the most-recent entry per item so the count reflects distinct items."""
    user_id = current_user["id"]
    h = await _get_or_create_household(user_id)
    cursor = db.household_activity.find(
        {"household_id": h["id"], "seen_by": {"$ne": user_id}},
        {"_id": 0},
    ).sort("created_at", -1).limit(100)

    seen_resource: set = set()
    items = []
    actor_names: Dict[str, str] = {}
    async for a in cursor:
        key = f"{a['resource']}:{a['resource_id']}"
        if key in seen_resource:
            continue
        seen_resource.add(key)
        actor_id = a.get("actor_user_id")
        if actor_id and actor_id not in actor_names:
            u = await db.users.find_one({"id": actor_id}, {"_id": 0, "name": 1, "email": 1})
            actor_names[actor_id] = ((u or {}).get("name") or ((u or {}).get("email") or "").split("@")[0] or "Someone")
        items.append({
            "id": a["id"],
            "resource": a["resource"],
            "resource_id": a["resource_id"],
            "resource_name": a.get("resource_name"),
            "action": a.get("action"),
            "actor_name": actor_names.get(actor_id, "Someone"),
            "created_at": a.get("created_at"),
        })
    return {"count": len(items), "items": items[:30]}


@router.post("/activity/mark-seen")
async def mark_seen(payload: Dict[str, Any] = Body(default={}), current_user=Depends(get_current_user)):
    """Mark activity as seen by the current user.
    Body: {all: true} to clear everything, or {resource_id: "..."} to clear one item."""
    user_id = current_user["id"]
    h = await _get_or_create_household(user_id)
    q: Dict[str, Any] = {"household_id": h["id"]}
    if payload.get("resource_id"):
        q["resource_id"] = payload["resource_id"]
    elif not payload.get("all"):
        return {"updated": 0}
    res = await db.household_activity.update_many(q, {"$addToSet": {"seen_by": user_id}})
    return {"updated": res.modified_count}
