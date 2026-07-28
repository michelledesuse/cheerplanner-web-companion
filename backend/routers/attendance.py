"""Team Hub — Attendance. Check off roster members per session (optionally
linked to a schedule event). Household-scoped, gated behind team access.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import (
    AttendanceSession,
    AttendanceSessionCreate,
    AttendanceSessionUpdate,
    AttendanceMarkPayload,
)
from core.security import get_current_user, require_team_access
from core.helpers import _team_hub_scope_user_ids as _household_user_ids, _blocked_resource_ids

router = APIRouter(prefix="/api/team", dependencies=[Depends(require_team_access)])


async def _roster_total(member_ids: List[str]) -> int:
    return await db.roster.count_documents({"user_id": {"$in": member_ids}, "role": {"$ne": "parent"}})


def _summary(sess: dict, roster_total: int) -> dict:
    records = sess.get("records") or {}
    present = sum(1 for v in records.values() if v == "present")
    absent = sum(1 for v in records.values() if v == "absent")
    excused = sum(1 for v in records.values() if v == "excused")
    return {
        "present": present, "absent": absent, "excused": excused,
        "member_total": roster_total, "unmarked": max(0, roster_total - present - absent - excused),
    }


async def _get_session(session_id: str, current_user) -> dict:
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.attendance_sessions.find_one({"id": session_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    return doc


@router.get("/attendance")
async def list_attendance(event_id: str | None = None, competition_id: str | None = None, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    query: dict = {"user_id": {"$in": member_ids}}
    if event_id:
        query["event_ids"] = event_id
    if competition_id:
        query["competition_ids"] = competition_id
    docs = await db.attendance_sessions.find(query, {"_id": 0}).to_list(1000)
    blocked = await _blocked_resource_ids(current_user["id"], "attendance")
    docs = [d for d in docs if d["id"] not in blocked]
    docs.sort(key=lambda d: (d.get("date") or "", d.get("created_at") or ""), reverse=True)
    roster_total = await _roster_total(member_ids)
    return [{**AttendanceSession(**d).model_dump(), "summary": _summary(d, roster_total)} for d in docs]


@router.post("/attendance", response_model=AttendanceSession)
async def create_attendance(payload: AttendanceSessionCreate, current_user=Depends(get_current_user)):
    if not (payload.title or "").strip():
        raise HTTPException(status_code=400, detail="Title is required")
    sess = AttendanceSession(
        user_id=current_user["id"], title=payload.title.strip(), date=payload.date,
        competition_ids=payload.competition_ids or [], event_ids=payload.event_ids or [],
    )
    await db.attendance_sessions.insert_one(sess.model_dump())
    return sess


@router.get("/attendance/{session_id}")
async def get_attendance(session_id: str, current_user=Depends(get_current_user)):
    if session_id in await _blocked_resource_ids(current_user["id"], "attendance"):
        raise HTTPException(status_code=403, detail="You don't have access to this session")
    member_ids = await _household_user_ids(current_user["id"])
    doc = await _get_session(session_id, current_user)
    roster_total = await _roster_total(member_ids)
    return {**AttendanceSession(**doc).model_dump(), "summary": _summary(doc, roster_total)}


@router.patch("/attendance/{session_id}", response_model=AttendanceSession)
async def update_attendance(session_id: str, payload: AttendanceSessionUpdate, current_user=Depends(get_current_user)):
    doc = await _get_session(session_id, current_user)
    updates = {}
    if payload.title is not None:
        if not payload.title.strip():
            raise HTTPException(status_code=400, detail="Title cannot be blank")
        updates["title"] = payload.title.strip()
    if payload.date is not None:
        updates["date"] = payload.date or None
    if payload.competition_ids is not None:
        updates["competition_ids"] = payload.competition_ids
    if payload.event_ids is not None:
        updates["event_ids"] = payload.event_ids
    if updates:
        await db.attendance_sessions.update_one({"id": doc["id"]}, {"$set": updates})
        doc.update(updates)
    return AttendanceSession(**doc)


@router.delete("/attendance/{session_id}")
async def delete_attendance(session_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.attendance_sessions.delete_one({"id": session_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    return {"deleted": True}


@router.put("/attendance/{session_id}/mark")
async def mark_attendance(session_id: str, payload: AttendanceMarkPayload, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await _get_session(session_id, current_user)
    rm = await db.roster.find_one({"id": payload.member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
    if not rm:
        raise HTTPException(status_code=404, detail="Roster member not found")
    records = doc.get("records") or {}
    if payload.status is None:
        records.pop(payload.member_id, None)
    else:
        records[payload.member_id] = payload.status
    await db.attendance_sessions.update_one({"id": doc["id"]}, {"$set": {"records": records}})
    doc["records"] = records
    roster_total = await _roster_total(member_ids)
    return {**AttendanceSession(**doc).model_dump(), "summary": _summary(doc, roster_total)}
