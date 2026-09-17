"""Smart Inbox.

Team members can forward a booking/receipt email, paste text, or drop a
screenshot into an in-app inbox. An LLM auto-detects whether it's a travel
booking or an expense and extracts the fields into a *draft* that the user
reviews and confirms before it becomes a real expense / booking.
"""
import json
import os
import re
import secrets
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.models import (
    InboxParseRequest, InboxDraft, InboxConfirmRequest,
    EXPENSE_CATEGORIES,
)
from core.security import get_current_user
from routers.expenses import create_expense
from routers.bookings import create_booking

load_dotenv()

router = APIRouter(prefix="/api")

# openai/gpt-5.4 is vision-capable and reliable for structured extraction.
_PROVIDER = "openai"
_MODEL = "gpt-5.4"

_SYSTEM = (
    "You extract structured data from travel booking confirmations and expense "
    "receipts for a cheerleading team planner. Given text and/or an image, decide "
    "if it is a TRAVEL booking (flight, hotel, or rental car) or an EXPENSE "
    "(a receipt, charge, or invoice). Return STRICT JSON only — no prose, no "
    "markdown code fences.\n\n"
    "Schema:\n"
    "{\n"
    '  "kind": "expense" | "booking" | "unknown",\n'
    '  "summary": "short one-line human summary",\n'
    '  "expense": {"category": string, "amount": number, "vendor": string, '
    '"incurred_on": "YYYY-MM-DD", "due_date": "YYYY-MM-DD or null", "note": string} or null,\n'
    '  "booking": {"type": "flight"|"hotel"|"car", "provider": string, '
    '"confirmation": string, "cost": number, "check_in": "YYYY-MM-DD", '
    '"check_out": "YYYY-MM-DD", "cancel_by": "YYYY-MM-DD", '
    '"pickup_at": "YYYY-MM-DDTHH:MM", "pickup_location": string, '
    '"dropoff_at": "YYYY-MM-DDTHH:MM", "dropoff_location": string, '
    '"flight_number": string, "depart_airport": "IATA", "arrive_airport": "IATA", '
    '"depart_time": "YYYY-MM-DDTHH:MM", "arrive_time": "YYYY-MM-DDTHH:MM", '
    '"outbound_cost": number, "return_flight_number": string, '
    '"return_depart_airport": "IATA", "return_arrive_airport": "IATA", '
    '"return_depart_time": "YYYY-MM-DDTHH:MM", "return_arrive_time": "YYYY-MM-DDTHH:MM", '
    '"return_cost": number, "notes": string} or null\n'
    "}\n\n"
    "Rules: Use null for any unknown field. Dates ISO format. Amounts are plain "
    "numbers without currency symbols. For an expense, choose the closest category "
    "from this list, defaulting to \"Misc\": " + ", ".join(EXPENSE_CATEGORIES) + ". "
    "Return ONLY the JSON object."
)


def _extract_json(raw: str) -> dict:
    """Best-effort parse of the model's JSON reply (tolerates code fences)."""
    s = (raw or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?", "", s).strip()
        s = re.sub(r"```$", "", s).strip()
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r"\{.*\}", s, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return {"kind": "unknown", "summary": "", "expense": None, "booking": None}


async def _parse_with_llm(text: Optional[str], image_base64: Optional[str]) -> dict:
    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI is not configured")

    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

    llm = LlmChat(
        api_key=api_key,
        session_id=f"inbox-{secrets.token_hex(6)}",
        system_message=_SYSTEM,
    ).with_model(_PROVIDER, _MODEL)

    prompt = "Extract the booking or expense from the following."
    if text:
        prompt += "\n\n---\n" + text[:8000]

    file_contents = []
    if image_base64:
        b64 = image_base64
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[-1]
        file_contents = [ImageContent(image_base64=b64)]

    msg = UserMessage(text=prompt, file_contents=file_contents or None)
    reply = await llm.send_message(msg)
    return _extract_json(reply if isinstance(reply, str) else str(reply))


def _summary_fallback(kind: str, parsed: dict) -> str:
    if parsed.get("summary"):
        return str(parsed["summary"])[:140]
    if kind == "expense" and parsed.get("expense"):
        e = parsed["expense"]
        return f"{e.get('vendor') or e.get('category') or 'Expense'} ${e.get('amount') or ''}".strip()
    if kind == "booking" and parsed.get("booking"):
        b = parsed["booking"]
        return f"{b.get('type', 'Booking').title()} — {b.get('provider') or ''}".strip(" —")
    return "Couldn't read this one"


async def _store_draft(user_id: str, source: str, raw_text: str, parsed: dict) -> InboxDraft:
    kind = parsed.get("kind") if parsed.get("kind") in ("expense", "booking") else "unknown"
    data = parsed.get(kind) if kind in ("expense", "booking") else {}
    draft = InboxDraft(
        user_id=user_id,
        kind=kind,
        source=source,
        summary=_summary_fallback(kind, parsed),
        raw_excerpt=(raw_text or "")[:500],
        data=data or {},
    )
    await db.inbox_drafts.insert_one(draft.model_dump())
    return draft


# --------------------------------------------------------------------------- #
# In-app: paste text / drop a screenshot                                       #
# --------------------------------------------------------------------------- #
@router.post("/inbox/parse", response_model=InboxDraft)
async def parse_inbox(payload: InboxParseRequest, current_user=Depends(get_current_user)):
    if not payload.text and not payload.image_base64:
        raise HTTPException(status_code=400, detail="Paste some text or add a screenshot")
    parsed = await _parse_with_llm(payload.text, payload.image_base64)
    return await _store_draft(
        current_user["id"], payload.source or "paste", payload.text or "", parsed
    )


@router.get("/inbox/drafts", response_model=List[InboxDraft])
async def list_drafts(current_user=Depends(get_current_user)):
    docs = await db.inbox_drafts.find(
        {"user_id": current_user["id"], "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return [InboxDraft(**d) for d in docs]


@router.post("/inbox/drafts/{draft_id}/confirm")
async def confirm_draft(draft_id: str, payload: InboxConfirmRequest, current_user=Depends(get_current_user)):
    draft = await db.inbox_drafts.find_one(
        {"id": draft_id, "user_id": current_user["id"]}, {"_id": 0}
    )
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    if payload.kind == "expense":
        if not payload.expense:
            raise HTTPException(status_code=400, detail="Missing expense details")
        result = await create_expense(payload.expense, current_user)
    elif payload.kind == "booking":
        if not payload.booking:
            raise HTTPException(status_code=400, detail="Missing booking details")
        result = await create_booking(payload.booking, current_user)
    else:
        raise HTTPException(status_code=400, detail="Choose expense or booking")

    await db.inbox_drafts.update_one({"id": draft_id}, {"$set": {"status": "confirmed"}})
    return {"ok": True, "kind": payload.kind, "created": result}


@router.delete("/inbox/drafts/{draft_id}")
async def dismiss_draft(draft_id: str, current_user=Depends(get_current_user)):
    res = await db.inbox_drafts.delete_one({"id": draft_id, "user_id": current_user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Email forwarding: a unique address per user + SendGrid Inbound Parse webhook #
# --------------------------------------------------------------------------- #
@router.get("/inbox/address")
async def inbox_address(current_user=Depends(get_current_user)):
    domain = os.environ.get("INBOUND_EMAIL_DOMAIN", "").strip()
    token = current_user.get("inbox_token")
    if not token:
        token = secrets.token_hex(8)
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"inbox_token": token}})
    address = f"add+{token}@{domain}" if domain else None
    return {"address": address, "configured": bool(domain)}


@router.post("/inbox/inbound-email")
async def inbound_email(request: Request):
    """SendGrid Inbound Parse posts a multipart form here. We resolve the user
    from the plus-token in the recipient address, then draft the email."""
    form = await request.form()
    to = str(form.get("to", "") or form.get("envelope", ""))
    m = re.search(r"add\+([a-f0-9]+)@", to)
    if not m:
        raise HTTPException(status_code=400, detail="Unrecognized recipient")
    token = m.group(1)
    user = await db.users.find_one({"inbox_token": token}, {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Unknown inbox")

    subject = str(form.get("subject", "") or "")
    body = str(form.get("text", "") or form.get("html", "") or "")
    raw = (subject + "\n\n" + body).strip()
    parsed = await _parse_with_llm(raw, None)
    await _store_draft(user["id"], "email", raw, parsed)
    return {"ok": True}
