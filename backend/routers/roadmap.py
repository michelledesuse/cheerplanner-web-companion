"""Community Roadmap — planned features (admin-managed) + user suggestions + upvotes.

Any authenticated user can:
  - view the roadmap (planned features + community suggestions),
  - submit a new suggestion,
  - toggle an upvote on any item.

Admins (ADMIN_EMAILS) additionally can:
  - add "planned" roadmap items,
  - edit an item's title/description/status/type,
  - delete an item.

Vote counts are stored so the operator can track the most-requested features.
One vote per user per item (roadmap_votes); the `upvotes` counter on the item is
kept in sync atomically for cheap sorting.
"""
import secrets
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.models import utcnow_iso
from core.security import get_current_user, require_admin

router = APIRouter(prefix="/api")

PLANNED_STATUSES = ("planned", "in_progress", "completed")


# ---------- payload models ----------
class SuggestionCreate(BaseModel):
    title: str
    description: str = ""


class PlannedCreate(BaseModel):
    title: str
    description: str = ""
    status: Literal["planned", "in_progress", "completed"] = "planned"


class ItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    type: Optional[Literal["planned", "suggestion"]] = None


def _clean(doc: dict, voted_ids: set) -> dict:
    doc["voted"] = doc["id"] in voted_ids
    doc["upvotes"] = int(doc.get("upvotes") or 0)
    return doc


@router.get("/roadmap")
async def list_roadmap(current_user=Depends(get_current_user)):
    """Return planned features + community suggestions, each with its upvote
    count and whether the current user has voted for it."""
    items = await db.roadmap_items.find({}, {"_id": 0}).to_list(1000)
    my_votes = await db.roadmap_votes.find(
        {"user_id": current_user["id"]}, {"_id": 0, "item_id": 1}
    ).to_list(2000)
    voted_ids = {v["item_id"] for v in my_votes}

    planned, suggestions = [], []
    for it in items:
        _clean(it, voted_ids)
        (planned if it.get("type") == "planned" else suggestions).append(it)

    # Planned: in-progress first, then planned, then completed; within a status by votes.
    order = {"in_progress": 0, "planned": 1, "completed": 2}
    planned.sort(key=lambda x: (order.get(x.get("status"), 1), -x["upvotes"], x.get("created_at", "")))
    # Suggestions: most upvoted first, then newest.
    suggestions.sort(key=lambda x: (-x["upvotes"], x.get("created_at", "")), reverse=False)

    return {"planned": planned, "suggestions": suggestions, "is_admin": bool(current_user.get("is_admin"))}


@router.post("/roadmap/suggestions")
async def create_suggestion(payload: SuggestionCreate, current_user=Depends(get_current_user)):
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Please add a short title for your idea.")
    if len(title) > 120:
        title = title[:120]
    doc = {
        "id": secrets.token_urlsafe(9),
        "type": "suggestion",
        "title": title,
        "description": (payload.description or "").strip()[:1000],
        "status": "suggested",
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name") or (current_user.get("email") or "").split("@")[0],
        "upvotes": 1,  # author auto-upvotes their own idea
        "created_at": utcnow_iso(),
        "updated_at": utcnow_iso(),
    }
    await db.roadmap_items.insert_one({**doc})
    # record the author's implicit vote so they can't double-count
    await db.roadmap_votes.insert_one({
        "id": secrets.token_urlsafe(9), "item_id": doc["id"],
        "user_id": current_user["id"], "created_at": utcnow_iso(),
    })
    doc["voted"] = True
    return doc


@router.post("/roadmap/{item_id}/vote")
async def toggle_vote(item_id: str, current_user=Depends(get_current_user)):
    item = await db.roadmap_items.find_one({"id": item_id}, {"_id": 0, "id": 1})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    existing = await db.roadmap_votes.find_one({"item_id": item_id, "user_id": current_user["id"]})
    if existing:
        await db.roadmap_votes.delete_one({"item_id": item_id, "user_id": current_user["id"]})
        await db.roadmap_items.update_one({"id": item_id}, {"$inc": {"upvotes": -1}})
        voted = False
    else:
        await db.roadmap_votes.insert_one({
            "id": secrets.token_urlsafe(9), "item_id": item_id,
            "user_id": current_user["id"], "created_at": utcnow_iso(),
        })
        await db.roadmap_items.update_one({"id": item_id}, {"$inc": {"upvotes": 1}})
        voted = True
    fresh = await db.roadmap_items.find_one({"id": item_id}, {"_id": 0, "upvotes": 1})
    count = max(0, int((fresh or {}).get("upvotes") or 0))
    if count < 0:
        await db.roadmap_items.update_one({"id": item_id}, {"$set": {"upvotes": 0}})
        count = 0
    return {"voted": voted, "upvotes": count}


# ---------- admin management ----------
@router.post("/roadmap/planned", dependencies=[Depends(require_admin)])
async def create_planned(payload: PlannedCreate, current_user=Depends(get_current_user)):
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required.")
    doc = {
        "id": secrets.token_urlsafe(9),
        "type": "planned",
        "title": title[:120],
        "description": (payload.description or "").strip()[:1000],
        "status": payload.status if payload.status in PLANNED_STATUSES else "planned",
        "created_by": current_user["id"],
        "created_by_name": "CheerPlanner Team",
        "upvotes": 0,
        "created_at": utcnow_iso(),
        "updated_at": utcnow_iso(),
    }
    await db.roadmap_items.insert_one({**doc})
    doc["voted"] = False
    return doc


@router.patch("/roadmap/{item_id}", dependencies=[Depends(require_admin)])
async def update_item(item_id: str, payload: ItemUpdate):
    updates = {}
    if payload.title is not None:
        t = payload.title.strip()
        if t:
            updates["title"] = t[:120]
    if payload.description is not None:
        updates["description"] = payload.description.strip()[:1000]
    if payload.status is not None:
        updates["status"] = payload.status
    if payload.type is not None:
        updates["type"] = payload.type
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    updates["updated_at"] = utcnow_iso()
    r = await db.roadmap_items.update_one({"id": item_id}, {"$set": updates})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await db.roadmap_items.find_one({"id": item_id}, {"_id": 0})
    return doc


@router.delete("/roadmap/{item_id}", dependencies=[Depends(require_admin)])
async def delete_item(item_id: str):
    r = await db.roadmap_items.delete_one({"id": item_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.roadmap_votes.delete_many({"item_id": item_id})
    return {"deleted": True}
