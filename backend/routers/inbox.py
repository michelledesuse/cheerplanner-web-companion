"""Smart Inbox.

Team members can forward a booking/receipt email, paste text, or drop a
screenshot into an in-app inbox. An LLM auto-detects whether it's a travel
booking or an expense and extracts the fields into a *draft* that the user
reviews and confirms before it becomes a real expense / booking.
"""
import base64
import json
import os
import re
import secrets
import time
from datetime import date
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.models import (
    InboxParseRequest, InboxDraft, InboxConfirmRequest, InboxConfirmAllRequest,
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
    "receipts for a cheerleading team planner. Given text and/or an image, pull out "
    "EVERY distinct travel booking (flight, hotel, rental car) and EVERY expense "
    "(receipt, charge, invoice) you can find. Think like TripIt: a single itinerary "
    "email often contains MULTIPLE items — e.g. a flight AND a hotel AND a rental car — "
    "and each must become its own item. Capture as much detail as possible; never "
    "leave a field blank if the information is present anywhere in the text or image. "
    "Return STRICT JSON only — no prose, no markdown code fences.\n\n"
    "Schema:\n"
    "{\n"
    '  "items": [\n'
    "    {\n"
    '      "kind": "expense" | "booking",\n'
    '      "summary": "short one-line human summary",\n'
    '      "expense": {"category": string, "amount": number, "vendor": string, '
    '"incurred_on": "YYYY-MM-DD", "due_date": "YYYY-MM-DD or null", "note": string} or null,\n'
    '      "booking": {"type": "flight"|"hotel"|"car", "provider": string, '
    '"address": string, "confirmation": string, "cost": number, "amount_paid": number, '
    '"balance_due_date": "YYYY-MM-DD", '
    '"check_in": "YYYY-MM-DD", "check_in_time": "HH:MM", '
    '"check_out": "YYYY-MM-DD", "check_out_time": "HH:MM", "cancel_by": "YYYY-MM-DD", '
    '"pickup_at": "YYYY-MM-DDTHH:MM", "pickup_location": string, '
    '"dropoff_at": "YYYY-MM-DDTHH:MM", "dropoff_location": string, '
    '"flight_number": string, "depart_airport": "IATA", "arrive_airport": "IATA", '
    '"depart_time": "YYYY-MM-DDTHH:MM", "arrive_time": "YYYY-MM-DDTHH:MM", '
    '"outbound_cost": number, "return_airline": string, "return_confirmation": string, '
    '"return_flight_number": string, '
    '"return_depart_airport": "IATA", "return_arrive_airport": "IATA", '
    '"return_depart_time": "YYYY-MM-DDTHH:MM", "return_arrive_time": "YYYY-MM-DDTHH:MM", '
    '"return_cost": number, "notes": string} or null\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "Rules:\n"
    "- Create a SEPARATE item for each distinct booking/expense. If an itinerary has a "
    "flight, a hotel, and a car, return THREE booking items. Never merge a hotel and a "
    "car (or two different hotels) into one item.\n"
    "- Combine a round-trip flight (outbound + return legs) into ONE flight item, using "
    "the return_* fields for the return leg. Separate one-way flights are separate items.\n"
    "- Put any extra details that don't have a dedicated field (seat, room type, "
    "guest/passenger names, loyalty number, number of nights, taxes/fees breakdown) into "
    "the item's \"notes\" so nothing is lost.\n"
    "- Use null for any field you truly cannot find. Dates in ISO format. Amounts are "
    "plain numbers without currency symbols.\n"
    "- For an expense, choose the closest category from this list, defaulting to "
    "\"Misc\": " + ", ".join(EXPENSE_CATEGORIES) + ".\n"
    "- If you find nothing usable, return {\"items\": []}.\n"
    "Return ONLY the JSON object."
)


def _strip_html(s: str) -> str:
    """Turn an HTML email body into readable plain text for the LLM."""
    if not s or "<" not in s:
        return s or ""
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|tr|li|h[1-6]|table)>", "\n", s)
    s = re.sub(r"(?i)</td>", "\t", s)
    s = re.sub(r"<[^>]+>", " ", s)
    # Decode the handful of entities that actually show up in itineraries.
    import html as _html
    s = _html.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return s.strip()


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


async def _parse_with_llm(text: Optional[str], image_base64: Optional[str]) -> List[dict]:
    """Return a list of normalized item dicts: {kind, summary, expense, booking}."""
    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI is not configured")

    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

    llm = LlmChat(
        api_key=api_key,
        session_id=f"inbox-{secrets.token_hex(6)}",
        system_message=_SYSTEM,
    ).with_model(_PROVIDER, _MODEL)

    prompt = "Extract every booking and expense from the following."
    if text:
        prompt += "\n\n---\n" + text[:16000]

    file_contents = []
    if image_base64:
        b64 = image_base64
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[-1]
        file_contents = [ImageContent(image_base64=b64)]

    msg = UserMessage(text=prompt, file_contents=file_contents or None)
    reply = await llm.send_message(msg)
    parsed = _extract_json(reply if isinstance(reply, str) else str(reply))
    return _items_from_parsed(parsed)


def _items_from_parsed(parsed: dict) -> List[dict]:
    """Normalize the model output into a list of {kind, summary, expense, booking}.
    Tolerates both the new {"items": [...]} shape and a legacy single object."""
    if not isinstance(parsed, dict):
        return []
    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        # Legacy single-object reply.
        raw_items = [parsed] if parsed.get("kind") in ("expense", "booking") else []
    out: List[dict] = []
    for it in raw_items:
        if not isinstance(it, dict):
            continue
        kind = it.get("kind")
        if kind not in ("expense", "booking"):
            # Infer from which payload is present.
            if it.get("booking"):
                kind = "booking"
            elif it.get("expense"):
                kind = "expense"
            else:
                continue
        payload = it.get(kind) or {}
        if not isinstance(payload, dict) or not any(v not in (None, "", 0) for v in payload.values()):
            continue
        out.append({
            "kind": kind,
            "summary": it.get("summary") or "",
            "expense": it.get("expense") if kind == "expense" else None,
            "booking": it.get("booking") if kind == "booking" else None,
        })
    return out


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


async def _store_drafts(user_id: str, source: str, raw_text: str, items: List[dict]) -> List[InboxDraft]:
    drafts: List[InboxDraft] = []
    for item in items:
        kind = item.get("kind") if item.get("kind") in ("expense", "booking") else "unknown"
        data = item.get(kind) if kind in ("expense", "booking") else {}
        draft = InboxDraft(
            user_id=user_id,
            kind=kind,
            source=source,
            summary=_summary_fallback(kind, item),
            raw_excerpt=(raw_text or "")[:500],
            data=data or {},
        )
        drafts.append(draft)
    if drafts:
        await db.inbox_drafts.insert_many([d.model_dump() for d in drafts])
    return drafts


async def _store_unreadable(user_id: str, source: str, raw_text: str) -> InboxDraft:
    """When the model finds nothing, keep a single 'unknown' draft so the forward
    isn't silently dropped and the user can set it manually."""
    draft = InboxDraft(
        user_id=user_id, kind="unknown", source=source,
        summary="Couldn't read this one — open to set it manually",
        raw_excerpt=(raw_text or "")[:500], data={},
    )
    await db.inbox_drafts.insert_one(draft.model_dump())
    return draft


# --------------------------------------------------------------------------- #
# In-app: paste text / drop a screenshot                                       #
# --------------------------------------------------------------------------- #
@router.post("/inbox/parse", response_model=List[InboxDraft])
async def parse_inbox(payload: InboxParseRequest, current_user=Depends(get_current_user)):
    if not payload.text and not payload.image_base64:
        raise HTTPException(status_code=400, detail="Paste some text or add a screenshot")
    items = await _parse_with_llm(payload.text, payload.image_base64)
    source = payload.source or "paste"
    raw = payload.text or ""
    if not items:
        return [await _store_unreadable(current_user["id"], source, raw)]
    return await _store_drafts(current_user["id"], source, raw, items)


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


@router.post("/inbox/drafts/confirm-all")
async def confirm_all_drafts(payload: InboxConfirmAllRequest, current_user=Depends(get_current_user)):
    """Add every pending draft in one tap. Expense drafts use the chosen athlete;
    booking drafts use the chosen competition. Drafts still missing what they need
    (or that couldn't be read) are left behind and reported as skipped."""
    from core.models import ExpenseCreate, BookingCreate

    drafts = await db.inbox_drafts.find(
        {"user_id": current_user["id"], "status": "pending"}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)

    created = 0
    skipped: List[str] = []
    for d in drafts:
        data = d.get("data") or {}
        try:
            if d.get("kind") == "expense":
                amount = data.get("amount")
                if not payload.athlete_id or amount in (None, "", 0):
                    skipped.append(d.get("summary") or "Expense")
                    continue
                exp = ExpenseCreate(
                    athlete_id=payload.athlete_id,
                    category=data.get("category") or "Misc",
                    amount=float(amount),
                    incurred_on=data.get("incurred_on") or date.today().isoformat(),
                    due_date=data.get("due_date") or None,
                    note=" — ".join([x for x in [data.get("vendor"), data.get("note")] if x]) or None,
                )
                await create_expense(exp, current_user)
            elif d.get("kind") == "booking":
                if not payload.competition_id:
                    skipped.append(d.get("summary") or "Travel")
                    continue
                booking_data = {k: v for k, v in data.items() if k in BookingCreate.model_fields}
                booking_data["competition_id"] = payload.competition_id
                booking_data["type"] = data.get("type") or "flight"
                bk = BookingCreate(**booking_data)
                await create_booking(bk, current_user)
            else:
                skipped.append(d.get("summary") or "Unknown item")
                continue
            await db.inbox_drafts.update_one({"id": d["id"]}, {"$set": {"status": "confirmed"}})
            created += 1
        except Exception:
            skipped.append(d.get("summary") or "Item")

    return {"ok": True, "created": created, "skipped": skipped}


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


def _verify_sendgrid_signature(raw_body: bytes, signature: str, timestamp: str) -> bool:
    """Verify SendGrid Inbound Parse webhook signature (ECDSA over timestamp+body).

    Only enforced when SENDGRID_PARSE_PUBLIC_KEY is configured; otherwise (dev /
    not-yet-set-up) we accept the request so the in-app flow keeps working.
    """
    pub_b64 = os.environ.get("SENDGRID_PARSE_PUBLIC_KEY", "").strip()
    if not pub_b64:
        return True  # verification not configured yet
    if not signature or not timestamp:
        return False
    try:
        if abs(time.time() - int(timestamp)) > 300:  # reject stale (>5 min)
            return False
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        public_key = serialization.load_der_public_key(base64.b64decode(pub_b64))
        public_key.verify(
            base64.b64decode(signature),
            timestamp.encode() + raw_body,
            ec.ECDSA(hashes.SHA256()),
        )
        return True
    except Exception:
        return False


@router.post("/inbox/inbound-email")
async def inbound_email(request: Request):
    """SendGrid Inbound Parse posts a multipart form here. We verify the webhook
    signature, resolve the user from the plus-token in the recipient address,
    then draft the email."""
    raw_body = await request.body()  # cached so request.form() can still parse
    sig = request.headers.get("X-Twilio-Email-Event-Webhook-Signature", "")
    ts = request.headers.get("X-Twilio-Email-Event-Webhook-Timestamp", "")
    if not _verify_sendgrid_signature(raw_body, sig, ts):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

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
    text_body = str(form.get("text", "") or "")
    if not text_body:
        text_body = _strip_html(str(form.get("html", "") or ""))
    raw = (subject + "\n\n" + text_body).strip()
    items = await _parse_with_llm(raw, None)
    if items:
        await _store_drafts(user["id"], "email", raw, items)
    else:
        await _store_unreadable(user["id"], "email", raw)
    return {"ok": True}
