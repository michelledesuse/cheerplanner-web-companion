from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    PackingTemplate, PackingTemplateCreate, PackingTemplateUpdate,
    PackingList, PackingListCreate, PackingListUpdate,
    PackingItem, PackingChecklistItem,
    CHEERPLANNER_STANDARD_PACKING, CHEERPLANNER_STANDARD_TIPS,
    utcnow_iso,
)
from core.security import get_current_user
from core.helpers import (
    _household_user_ids, _hydrate_template_items, _checklist_from_template_items,
)

router = APIRouter(prefix="/api")


@router.get("/packing-templates", response_model=List[PackingTemplate])
async def list_packing_templates(current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.packing_templates.find(
        {"user_id": {"$in": member_ids}}, {"_id": 0},
    ).sort([("is_default", -1), ("created_at", -1)]).to_list(500)
    return [PackingTemplate(**d) for d in docs]


@router.post("/packing-templates/seed-default", response_model=PackingTemplate)
async def seed_default_packing_template(current_user=Depends(get_current_user)):
    """Create the canonical CheerPlanner Standard template for this household.

    Idempotent — returns the existing default if already seeded.
    """
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.packing_templates.find_one(
        {"user_id": {"$in": member_ids}, "is_default": True}, {"_id": 0},
    )
    if existing:
        return PackingTemplate(**existing)
    items = [
        PackingItem(label=spec["label"], category=spec["category"], order=i)
        for i, spec in enumerate(CHEERPLANNER_STANDARD_PACKING)
    ]
    tpl = PackingTemplate(
        user_id=current_user["id"],
        name="CheerPlanner Standard",
        items=items,
        tips=list(CHEERPLANNER_STANDARD_TIPS),
        is_default=True,
    )
    await db.packing_templates.insert_one(tpl.model_dump())
    return tpl


@router.post("/packing-templates", response_model=PackingTemplate)
async def create_packing_template(payload: PackingTemplateCreate, current_user=Depends(get_current_user)):
    tpl = PackingTemplate(
        user_id=current_user["id"],
        name=payload.name.strip() or "Untitled list",
        items=_hydrate_template_items([
            i.model_dump() if isinstance(i, PackingItem) else i for i in payload.items
        ]),
        tips=payload.tips or [],
    )
    await db.packing_templates.insert_one(tpl.model_dump())
    return tpl


@router.patch("/packing-templates/{template_id}", response_model=PackingTemplate)
async def update_packing_template(template_id: str, payload: PackingTemplateUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    updates: Dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip() or "Untitled list"
    if payload.items is not None:
        updates["items"] = [i.model_dump() for i in _hydrate_template_items([
            i.model_dump() if isinstance(i, PackingItem) else i for i in payload.items
        ])]
    if payload.tips is not None:
        updates["tips"] = payload.tips
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.packing_templates.update_one(
        {"id": template_id, "user_id": {"$in": member_ids}}, {"$set": updates},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    doc = await db.packing_templates.find_one({"id": template_id}, {"_id": 0})
    return PackingTemplate(**doc)


@router.delete("/packing-templates/{template_id}")
async def delete_packing_template(template_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.packing_templates.delete_one({"id": template_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True}


@router.get("/competitions/{competition_id}/packing-list", response_model=Optional[PackingList])
async def get_packing_list(competition_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.packing_lists.find_one(
        {"competition_id": competition_id, "user_id": {"$in": member_ids}}, {"_id": 0},
    )
    return PackingList(**doc) if doc else None


@router.post("/competitions/{competition_id}/packing-list", response_model=PackingList)
async def create_or_replace_packing_list(
    competition_id: str,
    payload: PackingListCreate,
    current_user=Depends(get_current_user),
):
    member_ids = await _household_user_ids(current_user["id"])
    items: List[PackingChecklistItem]
    tips: List[str] = list(payload.tips or [])
    name: Optional[str] = payload.name
    if payload.items is not None:
        items = [
            i if isinstance(i, PackingChecklistItem) else PackingChecklistItem(**i)
            for i in payload.items
        ]
    elif payload.template_id:
        tpl_doc = await db.packing_templates.find_one(
            {"id": payload.template_id, "user_id": {"$in": member_ids}}, {"_id": 0},
        )
        if not tpl_doc:
            raise HTTPException(status_code=404, detail="Template not found")
        tpl = PackingTemplate(**tpl_doc)
        items = _checklist_from_template_items(tpl.items)
        if not tips:
            tips = list(tpl.tips)
        if not name:
            name = tpl.name
    else:
        items = []

    pl = PackingList(
        user_id=current_user["id"],
        competition_id=competition_id,
        template_id=payload.template_id,
        name=name,
        items=items,
        tips=tips,
        athlete_ids=payload.athlete_ids or [],
        updated_at=utcnow_iso(),
    )
    # Upsert — one packing list per (household, competition).
    await db.packing_lists.delete_many(
        {"competition_id": competition_id, "user_id": {"$in": member_ids}},
    )
    await db.packing_lists.insert_one(pl.model_dump())
    return pl


@router.patch("/packing-lists/{list_id}", response_model=PackingList)
async def update_packing_list(list_id: str, payload: PackingListUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.packing_lists.find_one(
        {"id": list_id, "user_id": {"$in": member_ids}}, {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Packing list not found")

    updates: Dict[str, Any] = {"updated_at": utcnow_iso()}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.items is not None:
        updates["items"] = [
            (i if isinstance(i, PackingChecklistItem) else PackingChecklistItem(**i)).model_dump()
            for i in payload.items
        ]
    if payload.tips is not None:
        updates["tips"] = payload.tips
    if payload.athlete_ids is not None:
        updates["athlete_ids"] = payload.athlete_ids

    await db.packing_lists.update_one(
        {"id": list_id, "user_id": {"$in": member_ids}}, {"$set": updates},
    )

    # Optionally snapshot current items into a fresh template.
    if payload.save_as_template_name:
        current_items = updates.get("items") or existing.get("items") or []
        tpl = PackingTemplate(
            user_id=current_user["id"],
            name=payload.save_as_template_name.strip() or "Saved list",
            items=[
                PackingItem(label=i.get("label", ""), category=i.get("category"), order=i.get("order", 0))
                for i in current_items if i.get("label")
            ],
            tips=(updates.get("tips") if "tips" in updates else existing.get("tips")) or [],
        )
        await db.packing_templates.insert_one(tpl.model_dump())

    doc = await db.packing_lists.find_one({"id": list_id}, {"_id": 0})
    return PackingList(**doc)


@router.delete("/packing-lists/{list_id}")
async def delete_packing_list(list_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.packing_lists.delete_one({"id": list_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Packing list not found")
    return {"deleted": True}
