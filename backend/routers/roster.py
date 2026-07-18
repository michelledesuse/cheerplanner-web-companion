from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    RosterMember,
    RosterMemberCreate,
    RosterMemberUpdate,
    RosterImportPayload,
)
from core.security import get_current_user, require_team_access
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api", dependencies=[Depends(require_team_access)])


def _split_name(full: str) -> tuple:
    parts = (full or "").strip().split()
    if not parts:
        return None, None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


@router.get("/roster", response_model=List[RosterMember])
async def list_roster(team_id: str | None = None, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    query: dict = {"user_id": {"$in": member_ids}}
    docs = await db.roster.find(query, {"_id": 0}).to_list(1000)
    # Migrate legacy single team_id -> team_ids list for older documents.
    for d in docs:
        if not d.get("team_ids"):
            d["team_ids"] = [d["team_id"]] if d.get("team_id") else []
    if team_id:
        if team_id == "none":
            docs = [d for d in docs if not d.get("team_ids")]
        else:
            docs = [d for d in docs if team_id in (d.get("team_ids") or [])]
    docs.sort(key=lambda d: ((d.get("last_name") or d.get("name") or "").lower(), (d.get("first_name") or "").lower()))
    return [RosterMember(**d) for d in docs]


@router.post("/roster", response_model=RosterMember)
async def create_roster_member(payload: RosterMemberCreate, current_user=Depends(get_current_user)):
    data = payload.model_dump(exclude_none=True)
    derived = f"{(payload.first_name or '').strip()} {(payload.last_name or '').strip()}".strip()
    name = (payload.name or derived or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    data.pop("name", None)
    member = RosterMember(user_id=current_user["id"], name=name, **data)
    await db.roster.insert_one(member.model_dump())
    return member


@router.patch("/roster/{member_id}", response_model=RosterMember)
async def update_roster_member(member_id: str, payload: RosterMemberUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.roster.find_one({"id": member_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Roster member not found")
    # Keep the display name in sync when first/last change and no explicit name given.
    if ("first_name" in updates or "last_name" in updates) and "name" not in updates:
        fn = updates.get("first_name", existing.get("first_name") or "")
        ln = updates.get("last_name", existing.get("last_name") or "")
        derived = f"{(fn or '').strip()} {(ln or '').strip()}".strip()
        if derived:
            updates["name"] = derived
    await db.roster.update_one({"id": member_id, "user_id": {"$in": member_ids}}, {"$set": updates})
    doc = await db.roster.find_one({"id": member_id}, {"_id": 0})
    return RosterMember(**doc)


@router.delete("/roster/{member_id}")
async def delete_roster_member(member_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.roster.delete_one({"id": member_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Roster member not found")
    return {"deleted": True}


@router.get("/roster/import-candidates")
async def roster_import_candidates(current_user=Depends(get_current_user)):
    """People we can pull into the roster in one tap: household athletes and
    household members (users). Excludes anyone already imported (by linked_id)."""
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.roster.find(
        {"user_id": {"$in": member_ids}, "linked_id": {"$ne": None}},
        {"_id": 0, "linked_id": 1},
    ).to_list(1000)
    linked = {d["linked_id"] for d in existing if d.get("linked_id")}

    athletes = []
    async for a in db.athletes.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1, "role": 1, "team_ids": 1}):
        if a["id"] in linked:
            continue
        team_ids = a.get("team_ids") or []
        athletes.append({
            "id": a["id"],
            "name": a.get("name"),
            "role": a.get("role") or "athlete",
            "team_id": team_ids[0] if team_ids else None,
        })

    members = []
    h = await db.households.find_one({"member_user_ids": current_user["id"]}, {"_id": 0})
    hu_ids = (h or {}).get("member_user_ids", [current_user["id"]])
    async for u in db.users.find({"id": {"$in": hu_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}):
        if u["id"] in linked:
            continue
        members.append({"id": u["id"], "name": u.get("name") or (u.get("email") or "").split("@")[0], "email": u.get("email")})

    return {"athletes": athletes, "members": members}


@router.post("/roster/import", response_model=List[RosterMember])
async def roster_import(payload: RosterImportPayload, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    # Guard against duplicates.
    existing = await db.roster.find(
        {"user_id": {"$in": member_ids}, "linked_id": {"$ne": None}},
        {"_id": 0, "linked_id": 1},
    ).to_list(1000)
    linked = {d["linked_id"] for d in existing if d.get("linked_id")}

    created: List[RosterMember] = []

    if payload.athlete_ids:
        async for a in db.athletes.find(
            {"user_id": {"$in": member_ids}, "id": {"$in": payload.athlete_ids}}, {"_id": 0}
        ):
            if a["id"] in linked:
                continue
            role = a.get("role") if a.get("role") in ("athlete", "coach", "team_rep", "staff") else "athlete"
            team_ids = a.get("team_ids") or []
            fn, ln = _split_name(a.get("name") or "Athlete")
            m = RosterMember(
                user_id=current_user["id"], name=a.get("name") or "Athlete", role=role,
                first_name=fn, last_name=ln,
                team_ids=team_ids, source="athlete", linked_id=a["id"],
            )
            created.append(m)

    if payload.member_user_ids:
        async for u in db.users.find(
            {"id": {"$in": payload.member_user_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}
        ):
            if u["id"] in linked:
                continue
            uname = u.get("name") or (u.get("email") or "Member").split("@")[0]
            fn, ln = _split_name(uname)
            m = RosterMember(
                user_id=current_user["id"],
                name=uname,
                first_name=fn, last_name=ln,
                role="parent", email=u.get("email"), source="household", linked_id=u["id"],
            )
            created.append(m)

    if created:
        await db.roster.insert_many([m.model_dump() for m in created])
    return created
