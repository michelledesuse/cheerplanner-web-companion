"""Competition Results & Season Rankings (Team Hub).

Staff enter placement / score / division / notes per competition. Each result
has a visibility toggle (private = staff only, team = athletes + parents can
see). A season summary lists all results for the team.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from core.db import db
from core.security import get_current_user, require_team_access
from core.helpers import _resolve_active_household
from routers.team_calendar import _hub_and_role

router = APIRouter(prefix="/api")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/team/results")
async def create_result(payload: dict = Body(...), user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=400, detail="No team hub found.")
    if not (payload.get("title") or "").strip():
        raise HTTPException(status_code=400, detail="Competition name is required.")
    vis = payload.get("visibility")
    vis = vis if vis in ("private", "team") else "private"
    res = {
        "id": str(uuid.uuid4()), "household_id": h["id"],
        "competition_id": payload.get("competition_id") or None,
        "title": payload["title"].strip(), "date": (payload.get("date") or "")[:10],
        "placement": (payload.get("placement") or "").strip(),
        "score": (payload.get("score") or "").strip(),
        "division": (payload.get("division") or "").strip(),
        "notes": (payload.get("notes") or "").strip(),
        "visibility": vis, "created_by": user["id"], "created_at": _now(),
        "order": 0, "archived": False,
    }
    await db.competition_results.insert_one(dict(res))
    return res


@router.post("/team/results/reorder")
async def reorder_results(payload: dict = Body(...), user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    for idx, rid in enumerate(payload.get("ids") or []):
        await db.competition_results.update_one({"id": rid, "household_id": h["id"]}, {"$set": {"order": idx}})
    return {"ok": True}


@router.patch("/team/results/{result_id}/archive")
async def archive_result(result_id: str, payload: dict = Body(...), user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    r = await db.competition_results.update_one({"id": result_id, "household_id": h["id"]}, {"$set": {"archived": bool(payload.get("archived", True))}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Result not found.")
    return {"ok": True}


@router.patch("/team/results/{result_id}")
async def update_result(result_id: str, payload: dict = Body(...), user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    upd = {}
    for f in ("title", "date", "placement", "score", "division", "notes"):
        if f in payload:
            upd[f] = (payload.get(f) or "").strip()
    if "visibility" in payload and payload["visibility"] in ("private", "team"):
        upd["visibility"] = payload["visibility"]
    r = await db.competition_results.update_one({"id": result_id, "household_id": h["id"]}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Result not found.")
    return {"ok": True}


@router.delete("/team/results/{result_id}")
async def delete_result(result_id: str, user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    await db.competition_results.delete_one({"id": result_id, "household_id": h["id"]})
    return {"ok": True}


@router.get("/team/results")
async def list_results(include_archived: bool = False, user=Depends(get_current_user)):
    h, role = await _hub_and_role(user)
    if not h:
        return {"role": "viewer", "results": [], "can_edit": False}
    q = {"household_id": h["id"]}
    if role != "staff":
        q["visibility"] = "team"
    if not include_archived:
        q["archived"] = {"$ne": True}
    results = await db.competition_results.find(q, {"_id": 0}).to_list(500)
    results.sort(key=lambda d: d.get("date") or "", reverse=True)
    results.sort(key=lambda d: d.get("order", 0))
    return {"role": role, "can_edit": role == "staff", "results": results}


@router.get("/team/results/competitions")
async def pick_competitions(user=Depends(require_team_access)):
    """Existing competitions the staff can attach a result to (for prefill)."""
    comps = await db.competitions.find({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1, "event_date": 1}).sort("event_date", -1).to_list(200)
    return {"competitions": [{"id": c["id"], "name": c.get("name"), "date": c.get("event_date")} for c in comps]}
