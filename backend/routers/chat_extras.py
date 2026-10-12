"""TeamChat add-ons that sit beside (and never change) the core chat:

* Pinned ITEMS — coaches/staff pin an event, competition, travel booking, or a
  custom detail to the top of a chat. Everyone in the chat sees a tappable card.
* Quick-add — the AI reads one message and suggests what it could become in the
  reader's OWN planner (calendar event, expense, fundraiser, competition,
  packing-list items, teams to watch). Saving uses the normal create endpoints.
"""
import json
import os
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core.db import db
from core.helpers import _household_user_ids
from core.models import utcnow_iso
from routers.team_chat import _chat_hub, require_chat_access

router = APIRouter(prefix="/api")

PIN_KINDS = ("event", "competition", "booking", "custom")


def _is_staff(user: dict) -> bool:
    return bool(user.get("team_access") or user.get("is_admin"))


def _booking_title(b: dict) -> str:
    t = (b.get("type") or "travel").capitalize()
    return f"{t} · {b.get('provider') or b.get('confirmation') or 'booking'}"


async def _snapshot(kind: str, ref_id: str, owner_ids: list) -> dict:
    """Build a self-contained card from a hub item so every chat member can read it."""
    q = {"id": ref_id, "user_id": {"$in": owner_ids}}
    if kind == "competition":
        c = await db.competitions.find_one(q, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Competition not found")
        return {"title": c["name"], "date": c.get("event_date"), "end_date": c.get("end_date"),
                "time": c.get("event_time"), "location": c.get("location"),
                "body": "\n".join(x for x in [
                    f"Meet: {c['meet_time']}" if c.get("meet_time") else "",
                    f"Meet at: {c['meeting_location']}" if c.get("meeting_location") else "",
                    f"Wear: {c['what_to_wear']}" if c.get("what_to_wear") else "",
                ] if x) or None}
    if kind == "event":
        e = await db.schedule_events.find_one(q, {"_id": 0})
        if not e:
            raise HTTPException(status_code=404, detail="Event not found")
        return {"title": e["title"], "date": e.get("date"), "end_date": e.get("end_date"),
                "time": e.get("start_time"), "location": e.get("location"), "body": e.get("notes")}
    b = await db.bookings.find_one(q, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    comp = await db.competitions.find_one({"id": b.get("competition_id")}, {"_id": 0, "name": 1})
    return {"title": _booking_title(b), "date": b.get("check_in") or (b.get("depart_time") or "")[:10] or None,
            "end_date": b.get("check_out"), "time": b.get("check_in_time"),
            "location": b.get("address") or b.get("pickup_location"),
            "body": "\n".join(x for x in [
                f"For {comp['name']}" if comp else "",
                f"Confirmation: {b['confirmation']}" if b.get("confirmation") else "",
                b.get("notes") or "",
            ] if x) or None,
            "competition_id": b.get("competition_id")}


# ------------------------------------------------------------- pinned items ---
@router.get("/team/chat/pin-items")
async def list_pin_items(channel_id: Optional[str] = None, current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"items": [], "can_pin": False}
    docs = await db.chat_pins.find(
        {"household_id": h["id"], "channel_id": channel_id or None}, {"_id": 0}
    ).sort("created_at", -1).to_list(30)
    mine = set(await _household_user_ids(current_user["id"]))
    for d in docs:
        # Only people who can see the original item get a link to its page.
        d["can_open"] = d["kind"] != "custom" and d.get("owner_id") in mine
    return {"items": docs, "can_pin": _is_staff(current_user)}


@router.get("/team/chat/pin-options")
async def pin_options(kind: str, current_user=Depends(require_chat_access)):
    if not _is_staff(current_user):
        raise HTTPException(status_code=403, detail="Only coaches and staff can pin.")
    ids = await _household_user_ids(current_user["id"])
    today = date.today().isoformat()
    if kind == "competition":
        rows = await db.competitions.find({"user_id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "event_date": 1}).to_list(300)
        out = [{"id": r["id"], "title": r["name"], "date": r.get("event_date")} for r in rows]
    elif kind == "event":
        rows = await db.schedule_events.find(
            {"user_id": {"$in": ids}, "$or": [{"date": {"$gte": today}}, {"recurrence_rule": {"$nin": [None, ""]}}]},
            {"_id": 0, "id": 1, "title": 1, "date": 1, "start_time": 1, "series_id": 1},
        ).sort("date", 1).to_list(300)
        seen, out = set(), []
        for r in rows:  # one row per recurring series
            key = r.get("series_id") or r["id"]
            if key in seen:
                continue
            seen.add(key)
            out.append({"id": r["id"], "title": r["title"], "date": r.get("date"), "time": r.get("start_time")})
    elif kind == "booking":
        rows = await db.bookings.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(300)
        names = {c["id"]: c["name"] async for c in db.competitions.find({"user_id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1})}
        out = [{"id": r["id"], "title": _booking_title(r), "subtitle": names.get(r.get("competition_id")),
                "date": r.get("check_in") or (r.get("depart_time") or "")[:10] or None} for r in rows]
    else:
        raise HTTPException(status_code=400, detail="Unknown kind")
    # Upcoming first (soonest at top), then past items.
    out.sort(key=lambda x: (0, x.get("date") or "9999") if (x.get("date") or "9999") >= today else (1, ""))
    return {"options": out}


@router.post("/team/chat/pin-items")
async def create_pin_item(payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    if not _is_staff(current_user):
        raise HTTPException(status_code=403, detail="Only coaches and staff can pin.")
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        raise HTTPException(status_code=403, detail="No chat available.")
    kind = payload.get("kind")
    if kind not in PIN_KINDS:
        raise HTTPException(status_code=400, detail="Pick an event, competition, booking, or detail.")
    channel_id = payload.get("channel_id") or None
    if kind == "custom":
        title = (payload.get("title") or "").strip()[:120]
        body = (payload.get("body") or "").strip()[:2000]
        if not title:
            raise HTTPException(status_code=400, detail="Give the detail a title.")
        snap, ref_id, owner_id = {"title": title, "body": body or None}, None, current_user["id"]
    else:
        ref_id = payload.get("ref_id")
        owners = await _household_user_ids(current_user["id"])
        snap = await _snapshot(kind, ref_id, owners)
        src = {"competition": db.competitions, "event": db.schedule_events, "booking": db.bookings}[kind]
        owner_id = (await src.find_one({"id": ref_id}, {"_id": 0, "user_id": 1}))["user_id"]
        if await db.chat_pins.find_one({"household_id": h["id"], "channel_id": channel_id, "ref_id": ref_id}):
            raise HTTPException(status_code=409, detail="That's already pinned here.")
    doc = {"id": str(uuid.uuid4()), "household_id": h["id"], "channel_id": channel_id, "kind": kind,
           "ref_id": ref_id, "owner_id": owner_id, **snap,
           "pinned_by": current_user["id"], "pinned_by_name": current_user.get("name") or "Coach",
           "created_at": utcnow_iso()}
    await db.chat_pins.insert_one(dict(doc))
    doc["can_open"] = kind != "custom"
    return doc


@router.delete("/team/chat/pin-items/{pin_id}")
async def delete_pin_item(pin_id: str, current_user=Depends(require_chat_access)):
    if not _is_staff(current_user):
        raise HTTPException(status_code=403, detail="Only coaches and staff can unpin.")
    h = await _chat_hub(current_user["id"], current_user)
    r = await db.chat_pins.delete_one({"id": pin_id, "household_id": (h or {}).get("id")})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Pin not found")
    return {"deleted": True}


# ---------------------------------------------------------------- quick-add ---
_QA_SYSTEM = (
    "You read ONE message from a cheerleading team group chat and decide what a parent could save "
    "from it into their planner. Return ONLY JSON with these optional keys (omit any that don't "
    "clearly apply; never invent facts):\n"
    '{"calendar": {"title": str, "date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "location": str, "notes": str},\n'
    ' "expense": {"category": str (e.g. Tuition, Uniform, Choreography, Competition Fee, Travel, Other), "amount": number, "due_date": "YYYY-MM-DD", "note": str},\n'
    ' "fundraiser": {"name": str, "goal_amount": number, "amount_raised": number, "date": "YYYY-MM-DD", "link_url": str, "note": str},\n'
    ' "competition": {"name": str, "event_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "location": str, "event_time": "HH:MM"},\n'
    ' "packing": {"items": [str], "competition_name": str},\n'
    ' "watch": {"teams": [{"name": str, "performance_time": "HH:MM"}], "competition_name": str}}\n'
    "Omit any field (e.g. location, time) the message does not state. Rules: calendar only if there is a specific date (practice, meeting, party, deadline). expense only "
    "with a money amount someone must pay. fundraiser only if the message is about a fundraiser. "
    "competition only if it names a cheer competition/event. packing only for things to bring/wear. "
    "watch only for other teams/divisions to watch. Times 24h. Resolve relative dates using today."
)


def _extract_json(raw: str) -> dict:
    raw = (raw or "").strip()
    if "```" in raw:
        raw = raw.split("```")[1].removeprefix("json").strip()
    start, end = raw.find("{"), raw.rfind("}")
    try:
        return json.loads(raw[start:end + 1]) if start >= 0 else {}
    except Exception:
        return {}


@router.post("/team/chat/messages/{message_id}/quick-add")
async def quick_add_suggestions(message_id: str, current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    m = await db.team_messages.find_one({"id": message_id, "household_id": (h or {}).get("id")}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Message not found")
    cached = await db.chat_quickadd.find_one({"message_id": message_id}, {"_id": 0})
    if cached:
        return {"suggestions": cached["suggestions"]}
    text = (m.get("text") or "").strip()
    sugg: dict = {}
    if text:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        today = date.today()
        chat = LlmChat(api_key=os.environ.get("EMERGENT_LLM_KEY"), session_id=f"qa-{message_id}",
                       system_message=_QA_SYSTEM).with_model("anthropic", "claude-haiku-4-5")
        try:
            raw = await chat.send_message(UserMessage(
                text=f"Today is {today.isoformat()} ({today.strftime('%A')}).\nMessage from {m.get('sender_name')}:\n{text}"))
            parsed = _extract_json(raw)
            sugg = {k: v for k, v in parsed.items()
                    if k in ("calendar", "expense", "fundraiser", "competition", "packing", "watch") and v}
        except Exception:
            raise HTTPException(status_code=502, detail="Couldn't read that message right now. Please try again.")
    await db.chat_quickadd.update_one({"message_id": message_id},
                                      {"$set": {"message_id": message_id, "suggestions": sugg, "created_at": utcnow_iso()}},
                                      upsert=True)
    return {"suggestions": sugg}
