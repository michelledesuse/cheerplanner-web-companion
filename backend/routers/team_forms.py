"""Team Hub — Custom Team Forms.

Coaches build named forms with typed questions (single-choice, multi-select,
yes/no, number, short text, paragraph). Each form can be attached to
competitions/events, season-scoped, and LOCKED to freeze submissions once an
order is finalized.

Responses are stored one-per-roster-member in `team_form_responses`. Coaches
fill on a member's behalf in-app; parents fill via the public share link
(routers/share.py, kind="form"), pre-filled with their prior answers.

Tally logic mirrors the Sizes tally: per-question value → count breakdown
(plus number sum/avg and a text answer list).
"""
import secrets
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.models import ExternalLink, utcnow_iso
from core.security import get_current_user, require_team_access
from core.helpers import (
    _team_hub_scope_user_ids as _household_user_ids,
    _blocked_resource_ids,
    season_query,
    roster_season_query,
    active_season_id,
)
from core.sms import send_sms, is_configured, normalize_us_phone

router = APIRouter(prefix="/api/team", dependencies=[Depends(require_team_access)])

QUESTION_TYPES = ("text", "paragraph", "choice", "multi", "yesno", "number")


# ---------- models ----------
class Question(BaseModel):
    id: str = Field(default_factory=lambda: secrets.token_urlsafe(6))
    label: str
    type: Literal["text", "paragraph", "choice", "multi", "yesno", "number"] = "text"
    options: List[str] = Field(default_factory=list)
    required: bool = False
    order: int = 0


class FormCreate(BaseModel):
    name: str
    description: str = ""
    questions: List[Question] = Field(default_factory=list)
    competition_ids: List[str] = Field(default_factory=list)
    event_ids: List[str] = Field(default_factory=list)
    links: List[ExternalLink] = Field(default_factory=list)
    close_at: Optional[str] = None


class FormUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    locked: Optional[bool] = None
    questions: Optional[List[Question]] = None
    competition_ids: Optional[List[str]] = None
    event_ids: Optional[List[str]] = None
    photos: Optional[List[str]] = None
    links: Optional[List[ExternalLink]] = None
    close_at: Optional[str] = None


class ResponseUpsert(BaseModel):
    member_id: str
    answers: dict = Field(default_factory=dict)


# ---------- helpers ----------
def _deadline_passed(close_at: Optional[str]) -> bool:
    if not close_at:
        return False
    try:
        dt = datetime.fromisoformat(str(close_at).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
    return now >= dt


async def apply_form_autolock(doc: dict) -> dict:
    """If a form has a close_at deadline that has passed, flip it to locked
    (persisted once). Returns the (possibly mutated) doc."""
    if doc and not doc.get("locked") and _deadline_passed(doc.get("close_at")):
        doc["locked"] = True
        await db.team_forms.update_one({"id": doc["id"]}, {"$set": {"locked": True}})
    return doc


async def _roster_total(member_ids: List[str], season_id: Optional[str] = None) -> int:
    q = await roster_season_query(member_ids, season_id)
    q["role"] = {"$ne": "parent"}
    return await db.roster.count_documents(q)


async def _get_form(form_id: str, current_user) -> dict:
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.team_forms.find_one({"id": form_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Form not found")
    return doc


def _tally(questions: List[dict], responses: List[dict]) -> List[dict]:
    """Per-question breakdown. choice/yesno → {value:count}; multi → across
    selections; number → count/sum/avg; text/paragraph → list of answers."""
    out = []
    for q in sorted(questions, key=lambda x: x.get("order", 0)):
        qid, qtype = q["id"], q.get("type", "text")
        entry = {"question_id": qid, "label": q.get("label"), "type": qtype}
        vals = [(r.get("answers") or {}).get(qid) for r in responses]
        vals = [v for v in vals if v not in (None, "", [])]
        if qtype in ("choice", "yesno"):
            counts: dict = {}
            for v in vals:
                counts[str(v)] = counts.get(str(v), 0) + 1
            entry["counts"] = [{"value": k, "count": c} for k, c in sorted(counts.items(), key=lambda kv: -kv[1])]
            entry["answered"] = len(vals)
        elif qtype == "multi":
            counts = {}
            for v in vals:
                for item in (v if isinstance(v, list) else [v]):
                    counts[str(item)] = counts.get(str(item), 0) + 1
            entry["counts"] = [{"value": k, "count": c} for k, c in sorted(counts.items(), key=lambda kv: -kv[1])]
            entry["answered"] = len(vals)
        elif qtype == "number":
            nums = []
            for v in vals:
                try:
                    nums.append(float(v))
                except (TypeError, ValueError):
                    pass
            total = sum(nums)
            entry["sum"] = round(total, 2)
            entry["avg"] = round(total / len(nums), 2) if nums else 0
            entry["answered"] = len(nums)
        else:  # text / paragraph
            entry["answers"] = [str(v) for v in vals]
            entry["answered"] = len(vals)
        out.append(entry)
    return out


async def _detail(doc: dict, member_ids: List[str]) -> dict:
    season_id = (doc.get("season_ids") or [None])[0]
    roster = await db.roster.find(
        {**await roster_season_query(member_ids, season_id), "role": {"$ne": "parent"}}, {"_id": 0}
    ).to_list(2000)
    roster.sort(key=lambda m: ((m.get("last_name") or m.get("name") or "").lower(), (m.get("first_name") or "").lower()))
    responses = await db.team_form_responses.find({"form_id": doc["id"]}, {"_id": 0}).to_list(3000)
    resp_by_member = {r["member_id"]: r for r in responses if r.get("member_id")}
    members = [{
        "id": m["id"], "name": m.get("name"), "team_ids": m.get("team_ids") or [],
        "answered": m["id"] in resp_by_member,
        "answers": (resp_by_member.get(m["id"]) or {}).get("answers") or {},
        "submitted_at": (resp_by_member.get(m["id"]) or {}).get("updated_at"),
    } for m in roster]
    return {
        **doc,
        "tally": _tally(doc.get("questions") or [], list(resp_by_member.values())),
        "members": members,
        "summary": {"response_count": len([m for m in members if m["answered"]]), "member_total": len(roster)},
    }


# ---------- endpoints ----------
@router.get("/forms")
async def list_forms(season_id: Optional[str] = None, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.team_forms.find(season_query(member_ids, season_id), {"_id": 0}).to_list(1000)
    blocked = await _blocked_resource_ids(current_user["id"], "form")
    docs = [d for d in docs if d["id"] not in blocked]
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    out = []
    for d in docs:
        await apply_form_autolock(d)
        rc = await db.team_form_responses.count_documents({"form_id": d["id"]})
        rt = await _roster_total(member_ids, (d.get("season_ids") or [None])[0])
        out.append({**d, "summary": {"response_count": rc, "member_total": rt}})
    return out


@router.post("/forms")
async def create_form(payload: FormCreate, current_user=Depends(get_current_user)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Form name is required.")
    member_ids = await _household_user_ids(current_user["id"])
    sid = await active_season_id(member_ids)
    questions = [q.model_dump() for q in payload.questions]
    for i, q in enumerate(questions):
        q["order"] = i
    doc = {
        "id": secrets.token_urlsafe(9), "user_id": current_user["id"], "name": name,
        "description": (payload.description or "").strip(), "locked": False,
        "questions": questions, "photos": [],
        "links": [l.model_dump() for l in payload.links],
        "competition_ids": payload.competition_ids or [], "event_ids": payload.event_ids or [],
        "season_ids": [sid] if sid else [], "close_at": payload.close_at or None,
        "created_at": utcnow_iso(), "updated_at": utcnow_iso(),
    }
    await db.team_forms.insert_one({**doc})
    return doc


@router.get("/forms/{form_id}")
async def get_form(form_id: str, current_user=Depends(get_current_user)):
    if form_id in await _blocked_resource_ids(current_user["id"], "form"):
        raise HTTPException(status_code=403, detail="You don't have access to this form")
    member_ids = await _household_user_ids(current_user["id"])
    doc = await _get_form(form_id, current_user)
    await apply_form_autolock(doc)
    return await _detail(doc, member_ids)


@router.patch("/forms/{form_id}")
async def update_form(form_id: str, payload: FormUpdate, current_user=Depends(get_current_user)):
    doc = await _get_form(form_id, current_user)
    updates: dict = {}
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Name cannot be blank")
        updates["name"] = payload.name.strip()
    if payload.description is not None:
        updates["description"] = payload.description.strip()
    if payload.locked is not None:
        updates["locked"] = bool(payload.locked)
    if payload.questions is not None:
        qs = [q.model_dump() for q in payload.questions]
        for i, q in enumerate(qs):
            q["order"] = i
        updates["questions"] = qs
    if payload.competition_ids is not None:
        updates["competition_ids"] = payload.competition_ids
    if payload.event_ids is not None:
        updates["event_ids"] = payload.event_ids
    if payload.photos is not None:
        updates["photos"] = payload.photos
    if payload.links is not None:
        updates["links"] = [l.model_dump() for l in payload.links]
    if payload.close_at is not None:
        updates["close_at"] = payload.close_at or None
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    updates["updated_at"] = utcnow_iso()
    await db.team_forms.update_one({"id": form_id}, {"$set": updates})
    member_ids = await _household_user_ids(current_user["id"])
    doc.update(updates)
    return await _detail(doc, member_ids)


@router.delete("/forms/{form_id}")
async def delete_form(form_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.team_forms.delete_one({"id": form_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Form not found")
    await db.team_form_responses.delete_many({"form_id": form_id})
    return {"deleted": True}


@router.post("/forms/{form_id}/duplicate")
async def duplicate_form(form_id: str, current_user=Depends(get_current_user)):
    doc = await _get_form(form_id, current_user)
    copy = {
        "id": secrets.token_urlsafe(9), "user_id": current_user["id"],
        "name": f"{doc.get('name')} (copy)", "description": doc.get("description") or "",
        "locked": False, "questions": list(doc.get("questions") or []), "photos": [],
        "links": list(doc.get("links") or []),
        "competition_ids": list(doc.get("competition_ids") or []),
        "event_ids": list(doc.get("event_ids") or []),
        "season_ids": list(doc.get("season_ids") or []),
        "created_at": utcnow_iso(), "updated_at": utcnow_iso(),
    }
    await db.team_forms.insert_one({**copy})
    return copy


@router.put("/forms/{form_id}/response")
async def upsert_response(form_id: str, payload: ResponseUpsert, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await _get_form(form_id, current_user)
    await apply_form_autolock(doc)
    if doc.get("locked"):
        raise HTTPException(status_code=400, detail="This form is locked — no more changes allowed.")
    rm = await db.roster.find_one({"id": payload.member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1})
    if not rm:
        raise HTTPException(status_code=404, detail="Roster member not found")
    now = utcnow_iso()
    existing = await db.team_form_responses.find_one({"form_id": form_id, "member_id": payload.member_id}, {"_id": 0, "id": 1})
    if existing:
        await db.team_form_responses.update_one(
            {"id": existing["id"]},
            {"$set": {"answers": payload.answers or {}, "respondent_name": rm.get("name"), "updated_at": now, "source": "coach"}},
        )
    else:
        await db.team_form_responses.insert_one({
            "id": secrets.token_urlsafe(9), "form_id": form_id, "user_id": doc["user_id"],
            "member_id": payload.member_id, "respondent_name": rm.get("name"),
            "answers": payload.answers or {}, "source": "coach",
            "created_at": now, "updated_at": now,
        })
    return await _detail(doc, member_ids)


@router.delete("/forms/{form_id}/response/{member_id}")
async def clear_response(form_id: str, member_id: str, current_user=Depends(get_current_user)):
    doc = await _get_form(form_id, current_user)
    if doc.get("locked"):
        raise HTTPException(status_code=400, detail="This form is locked.")
    await db.team_form_responses.delete_one({"form_id": form_id, "member_id": member_id})
    member_ids = await _household_user_ids(current_user["id"])
    return await _detail(doc, member_ids)


@router.post("/forms/{form_id}/remind")
async def remind_form(form_id: str, payload: dict, current_user=Depends(get_current_user)):
    """Text the public form link to roster parents who haven't responded yet."""
    if not is_configured():
        raise HTTPException(status_code=400, detail="SMS isn't configured. Add your Twilio number in settings.")
    base = str((payload or {}).get("base_url") or "").rstrip("/")
    if not base.startswith("https://"):
        raise HTTPException(status_code=400, detail="A valid https base_url is required")
    member_ids = await _household_user_ids(current_user["id"])
    doc = await _get_form(form_id, current_user)

    # create/reuse a public share link for this form
    from core.models import ShareLink
    existing = await db.share_links.find_one(
        {"kind": "form", "ref_id": form_id, "user_id": {"$in": member_ids}, "active": True}, {"_id": 0, "token": 1}
    )
    token = existing["token"] if existing else None
    if not token:
        link = ShareLink(token=secrets.token_urlsafe(9), kind="form", ref_id=form_id, user_id=current_user["id"])
        await db.share_links.insert_one(link.model_dump())
        token = link.token
    url = f"{base}/api/public/s/{token}"

    answered = {r["member_id"] async for r in db.team_form_responses.find({"form_id": form_id}, {"_id": 0, "member_id": 1})}
    roster = await db.roster.find(
        {**await roster_season_query(member_ids, (doc.get("season_ids") or [None])[0]), "role": {"$ne": "parent"}}, {"_id": 0}
    ).to_list(2000)

    sent, no_phone, failed = 0, [], []
    for m in roster:
        if m["id"] in answered:
            continue
        phone = (m.get("parent_phone") or m.get("phone")) if m.get("role") == "athlete" else (m.get("phone") or m.get("parent_phone"))
        if not normalize_us_phone(phone):
            no_phone.append(m.get("name"))
            continue
        first = (m.get("parent_first_name") or m.get("first_name") or (m.get("name") or "").split(" ")[0] or "there")
        body = f"Hi {first}, please fill out '{doc.get('name')}' for the team here: {url} Thank you!"
        if send_sms(phone, body):
            sent += 1
        else:
            failed.append(m.get("name"))
    if sent > 0:
        await db.team_forms.update_one({"id": form_id}, {"$set": {"last_reminded_at": utcnow_iso()}})
    return {"sent": sent, "no_phone": no_phone, "failed": failed, "url": url, "token": token}
