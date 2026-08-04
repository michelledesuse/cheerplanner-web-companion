"""Twilio webhooks — delivery status callbacks + inbound replies (public).

- POST /api/twilio/status : Twilio posts message delivery status here (we attach
  this URL as statusCallback on each outbound broadcast message). Updates the
  matching sms_messages doc and rolls up delivered/undelivered counts on the
  parent broadcast.
- POST /api/twilio/inbound : Twilio posts inbound SMS here (configure this as the
  number's "A message comes in" webhook in the Twilio console). We match the
  sender to a roster member and store it so replies show up in the app.

Note: SMS has no "read" receipt (that's iMessage/RCS only) — Twilio reports
delivered/undelivered, which is what we surface.
"""
import logging

from fastapi import APIRouter, Request
from fastapi.responses import Response

from core.db import db
from core.models import utcnow_iso
from core.sms import normalize_us_phone

logger = logging.getLogger("routers.twilio_hooks")
router = APIRouter(prefix="/api")


@router.post("/twilio/status")
async def twilio_status(request: Request):
    form = await request.form()
    sid = form.get("MessageSid") or form.get("SmsSid")
    status = (form.get("MessageStatus") or form.get("SmsStatus") or "").lower()
    if not sid or not status:
        return Response(status_code=204)
    doc = await db.sms_messages.find_one({"sid": sid}, {"_id": 0, "id": 1, "broadcast_id": 1, "status": 1})
    if not doc:
        return Response(status_code=204)
    prev = doc.get("status")
    await db.sms_messages.update_one({"sid": sid}, {"$set": {"status": status, "updated_at": utcnow_iso()}})
    # roll up counts on the broadcast when entering a terminal state
    bid = doc.get("broadcast_id")
    if bid and status != prev:
        inc = {}
        if status == "delivered":
            inc["delivered"] = 1
        elif status in ("failed", "undelivered"):
            inc["undelivered"] = 1
        if inc:
            await db.broadcasts.update_one({"id": bid}, {"$inc": inc})
    return Response(status_code=204)


@router.post("/twilio/inbound")
async def twilio_inbound(request: Request):
    form = await request.form()
    from_raw = form.get("From") or ""
    body = form.get("Body") or ""
    sid = form.get("MessageSid") or form.get("SmsSid") or ""
    phone = normalize_us_phone(from_raw)
    if not phone:
        return Response(content="<Response></Response>", media_type="application/xml")

    # Match the sender to a roster member (parent_phone or phone) to find the household.
    variants = {phone, phone.lstrip("+"), phone[-10:]}
    member = await db.roster.find_one(
        {"$or": [{"parent_phone": {"$in": list(variants)}}, {"phone": {"$in": list(variants)}}]},
        {"_id": 0, "id": 1, "user_id": 1, "name": 1, "parent_first_name": 1},
    )
    # Fallback: loose match against any stored number containing the last 10 digits
    if not member:
        last10 = phone[-10:]
        cursor = db.roster.find({}, {"_id": 0, "id": 1, "user_id": 1, "name": 1, "parent_phone": 1, "phone": 1})
        async for r in cursor:
            for f in (r.get("parent_phone"), r.get("phone")):
                if f and normalize_us_phone(f) == phone or (f and last10 in "".join(ch for ch in str(f) if ch.isdigit())):
                    member = r
                    break
            if member:
                break

    await db.sms_messages.insert_one({
        "id": sid or utcnow_iso(), "sid": sid, "direction": "in", "phone": phone,
        "body": body, "status": "received",
        "user_id": member.get("user_id") if member else None,
        "member_id": member.get("id") if member else None,
        "member_name": (member.get("parent_first_name") or member.get("name")) if member else None,
        "created_at": utcnow_iso(),
    })
    return Response(content="<Response></Response>", media_type="application/xml")
