"""Team Hub — personalized text broadcast to the roster.

Composes a single SMS per PARENT/guardian (falling back to the member's own
contact for staff/coaches), optionally with tappable links, uploaded Team Music
tracks (as a public play page) and photo/file attachments (hosted + linked).

Twilio SMS is text-only, so music and attachments are delivered as public,
no-login links. Public media is served from `public_media` docs which point at a
GridFS object (team_music bucket for tracks, broadcast_media bucket for files).
"""
import base64
import re
import secrets
from datetime import datetime, timezone
from typing import List, Optional, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, HTMLResponse
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from core.db import db
from core.models import ExternalLink, utcnow_iso
from core.security import get_current_user, require_team_access
from core.helpers import _team_hub_scope_user_ids
from core.sms import send_sms, send_sms_ex, is_configured, normalize_us_phone, join_links

router = APIRouter(prefix="/api")

_files_bucket = AsyncIOMotorGridFSBucket(db, bucket_name="broadcast_media")
_music_bucket = AsyncIOMotorGridFSBucket(db, bucket_name="team_music")

MAX_ATTACH_BYTES = 6 * 1024 * 1024  # 6 MB per attachment


# ---------- payload models ----------
class BroadcastRecipients(BaseModel):
    mode: Literal["all", "team", "members"] = "all"
    team_id: Optional[str] = None
    member_ids: List[str] = Field(default_factory=list)


class AttachmentUpload(BaseModel):
    filename: Optional[str] = None
    content_type: Optional[str] = "image/jpeg"
    data_base64: str


class BroadcastSend(BaseModel):
    message: str = ""
    recipients: BroadcastRecipients = Field(default_factory=BroadcastRecipients)
    links: List[ExternalLink] = Field(default_factory=list)
    track_ids: List[str] = Field(default_factory=list)
    attachment_tokens: List[str] = Field(default_factory=list)
    base_url: str = ""
    dry_run: bool = False
    send_at: Optional[str] = None  # ISO datetime; if set (and not dry_run) the send is scheduled


def _base(url: str) -> str:
    base = (url or "").rstrip("/")
    if not base.startswith("https://"):
        raise HTTPException(status_code=400, detail="A valid https base_url is required")
    return base


async def _music_public_url(track: dict, base: str, user_id: str) -> Optional[str]:
    if not track.get("gridfs_id"):
        return None
    existing = await db.public_media.find_one({"kind": "music", "source_id": track["id"]}, {"_id": 0, "token": 1})
    if existing:
        token = existing["token"]
    else:
        token = secrets.token_urlsafe(9)
        await db.public_media.insert_one({
            "token": token, "kind": "music", "bucket": "team_music",
            "gridfs_id": track["gridfs_id"], "content_type": track.get("content_type") or "audio/mpeg",
            "title": track.get("title") or "Track", "source_id": track["id"],
            "user_id": user_id, "created_at": utcnow_iso(),
        })
    return f"{base}/api/public/media/{token}"


@router.post("/team/broadcast/attachment", dependencies=[Depends(require_team_access)])
async def upload_attachment(payload: AttachmentUpload, current_user=Depends(get_current_user)):
    """Store one attachment and return a public link + token to reference on send."""
    raw = payload.data_base64 or ""
    if "," in raw and raw.strip().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid attachment data")
    if not data:
        raise HTTPException(status_code=400, detail="Empty attachment")
    if len(data) > MAX_ATTACH_BYTES:
        raise HTTPException(status_code=400, detail="Attachment too large (max 6 MB).")
    filename = (payload.filename or "attachment")[:120]
    gid = await _files_bucket.upload_from_stream(filename, data)
    token = secrets.token_urlsafe(9)
    await db.public_media.insert_one({
        "token": token, "kind": "file", "bucket": "broadcast_media",
        "gridfs_id": str(gid), "content_type": payload.content_type or "application/octet-stream",
        "title": filename, "size": len(data), "user_id": current_user["id"], "created_at": utcnow_iso(),
    })
    return {"token": token, "filename": filename, "size": len(data)}


@router.post("/team/broadcast/send", dependencies=[Depends(require_team_access)])
async def send_broadcast(payload: BroadcastSend, current_user=Depends(get_current_user)):
    msg = (payload.message or "").strip()
    if not msg and not payload.links and not payload.track_ids and not payload.attachment_tokens:
        raise HTTPException(status_code=400, detail="Add a message or something to share.")
    base = _base(payload.base_url)
    scope = await _team_hub_scope_user_ids(current_user["id"])
    to_send, no_phone, trailer = await _resolve_context(payload, base, scope, current_user["id"])

    def compose(name: str) -> str:
        greeting = f"Hi {name}, " if name else ""
        return f"{greeting}{msg}{trailer}".strip()

    if payload.dry_run:
        preview = [{"name": n or "(no name)", "phone": _mask(p), "body": compose(n)} for p, n in to_send[:50]]
        return {
            "recipient_count": len(to_send), "no_phone_count": len(no_phone),
            "no_phone": no_phone[:50], "sms_configured": is_configured(), "preview": preview,
        }

    # ---- schedule for later ----
    if payload.send_at:
        try:
            when = datetime.fromisoformat(payload.send_at.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid schedule time.")
        doc = {
            "id": secrets.token_urlsafe(9), "user_id": current_user["id"],
            "created_by_name": current_user.get("name") or current_user.get("email") or "",
            "send_at": when.astimezone(timezone.utc).isoformat(), "status": "scheduled",
            "message": msg, "recipient_count": len(to_send),
            "payload": payload.model_dump(exclude={"dry_run", "send_at"}),
            "created_at": utcnow_iso(),
        }
        await db.scheduled_broadcasts.insert_one({**doc})
        doc.pop("payload", None)
        return {"scheduled": True, **doc}

    if not is_configured():
        raise HTTPException(status_code=400, detail="SMS isn't set up yet. Add your Twilio number in Settings.")
    if not to_send:
        raise HTTPException(status_code=400, detail="No recipients have a phone number on file.")

    creator = current_user.get("name") or current_user.get("email") or ""
    return await _perform_send(current_user["id"], base, to_send, no_phone, msg, trailer, creator, payload)


async def _resolve_context(payload: BroadcastSend, base: str, scope: List[str], user_id: str):
    """Return (to_send[(phone,name)], no_phone[names], trailer) for a payload."""
    q: dict = {"user_id": {"$in": scope}}
    r = payload.recipients
    if r.mode == "team" and r.team_id:
        q["team_ids"] = r.team_id
    elif r.mode == "members" and r.member_ids:
        q["id"] = {"$in": r.member_ids}
    roster = await db.roster.find(q, {"_id": 0}).to_list(3000)

    trailer_parts: List[str] = []
    lk = join_links([l.model_dump() for l in payload.links])
    if lk:
        trailer_parts.append(lk)
    for tid in payload.track_ids:
        track = await db.team_music.find_one({"id": tid, "user_id": {"$in": scope}, "status": "ready"}, {"_id": 0})
        if track:
            url = await _music_public_url(track, base, user_id)
            if url:
                trailer_parts.append(f"🎵 {track.get('title') or 'Track'}: {url}")
    for tok in payload.attachment_tokens:
        media = await db.public_media.find_one({"token": tok, "kind": "file"}, {"_id": 0, "token": 1, "title": 1})
        if media:
            trailer_parts.append(f"📎 {media.get('title') or 'Attachment'}: {base}/api/public/media/{media['token']}")
    trailer = ("\n\n" + "\n".join(trailer_parts)) if trailer_parts else ""

    seen, to_send, no_phone = set(), [], []
    for m in roster:
        name = (m.get("parent_first_name") or "").strip() or (m.get("first_name") or "").strip() or (m.get("name") or "").split(" ")[0]
        phone = normalize_us_phone(m.get("parent_phone") or m.get("phone"))
        if not phone:
            no_phone.append(m.get("name") or name or "Unknown")
            continue
        if phone in seen:
            continue
        seen.add(phone)
        to_send.append((phone, name))
    return to_send, no_phone, trailer


async def _perform_send(user_id, base, to_send, no_phone, msg, trailer, creator, payload, broadcast_id=None):
    bid = broadcast_id or secrets.token_urlsafe(9)
    cb = f"{base}/api/twilio/status?b={bid}"

    def compose(name: str) -> str:
        greeting = f"Hi {name}, " if name else ""
        return f"{greeting}{msg}{trailer}".strip()

    sent, failed_targets, msg_docs = 0, [], []
    for phone, name in to_send:
        sid = send_sms_ex(phone, compose(name), status_callback=cb)
        if sid:
            sent += 1
            msg_docs.append({
                "id": secrets.token_urlsafe(9), "broadcast_id": bid, "user_id": user_id,
                "member_name": name or "", "phone": phone, "sid": sid, "status": "sent",
                "direction": "out", "created_at": utcnow_iso(), "updated_at": utcnow_iso(),
            })
        else:
            failed_targets.append({"name": name or "(no name)", "phone": phone})

    if msg_docs:
        await db.sms_messages.insert_many(msg_docs)

    await db.broadcasts.insert_one({
        "id": bid, "user_id": user_id, "created_by_name": creator, "message": msg,
        "body_trailer": trailer, "recipient_count": len(to_send), "sent": sent,
        "failed": len(failed_targets), "delivered": 0, "undelivered": 0,
        "failed_recipients": [{"name": t["name"], "phone": _mask(t["phone"])} for t in failed_targets],
        "failed_targets": failed_targets, "no_phone": no_phone,
        "track_count": len(payload.track_ids), "attachment_count": len(payload.attachment_tokens),
        "created_at": utcnow_iso(),
    })
    return {
        "id": bid, "sent": sent, "failed": len(failed_targets),
        "failed_recipients": [{"name": t["name"], "phone": _mask(t["phone"])} for t in failed_targets],
        "no_phone_count": len(no_phone), "no_phone": no_phone[:100],
    }


@router.post("/team/broadcast/{broadcast_id}/resend-failed", dependencies=[Depends(require_team_access)])
async def resend_failed(broadcast_id: str, base_url: str = "", current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    b = await db.broadcasts.find_one({"id": broadcast_id, "user_id": {"$in": scope}}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Broadcast not found")
    targets = b.get("failed_targets") or []
    if not targets:
        raise HTTPException(status_code=400, detail="Nothing to resend — no failed recipients.")
    if not is_configured():
        raise HTTPException(status_code=400, detail="SMS isn't set up yet.")
    base = _base(base_url) if base_url else None
    cb = f"{base}/api/twilio/status?b={broadcast_id}" if base else None
    msg, trailer = b.get("message") or "", b.get("body_trailer") or ""

    still_failed, sent, new_docs = [], 0, []
    for t in targets:
        body = (f"Hi {t['name']}, " if t.get("name") and t["name"] != "(no name)" else "") + f"{msg}{trailer}"
        sid = send_sms_ex(t["phone"], body.strip(), status_callback=cb)
        if sid:
            sent += 1
            new_docs.append({
                "id": secrets.token_urlsafe(9), "broadcast_id": broadcast_id, "user_id": current_user["id"],
                "member_name": t.get("name") or "", "phone": t["phone"], "sid": sid, "status": "sent",
                "direction": "out", "created_at": utcnow_iso(), "updated_at": utcnow_iso(),
            })
        else:
            still_failed.append(t)
    if new_docs:
        await db.sms_messages.insert_many(new_docs)
    await db.broadcasts.update_one({"id": broadcast_id}, {"$set": {
        "failed_targets": still_failed,
        "failed_recipients": [{"name": t["name"], "phone": _mask(t["phone"])} for t in still_failed],
        "failed": len(still_failed),
    }, "$inc": {"sent": sent}})
    return {"resent": sent, "still_failed": len(still_failed)}


@router.get("/team/broadcast/{broadcast_id}/statuses", dependencies=[Depends(require_team_access)])
async def broadcast_statuses(broadcast_id: str, current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    b = await db.broadcasts.find_one({"id": broadcast_id, "user_id": {"$in": scope}}, {"_id": 0, "id": 1})
    if not b:
        raise HTTPException(status_code=404, detail="Not found")
    msgs = await db.sms_messages.find({"broadcast_id": broadcast_id, "direction": "out"}, {"_id": 0, "sid": 0}).to_list(3000)
    counts = {"delivered": 0, "sent": 0, "failed": 0, "undelivered": 0}
    for m in msgs:
        s = m.get("status")
        if s == "delivered":
            counts["delivered"] += 1
        elif s in ("failed", "undelivered"):
            counts["undelivered"] += 1
        else:
            counts["sent"] += 1
    return {"counts": counts, "messages": msgs}


# ---------- scheduled broadcasts ----------
@router.get("/team/broadcast/scheduled", dependencies=[Depends(require_team_access)])
async def list_scheduled(current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    docs = await db.scheduled_broadcasts.find(
        {"user_id": {"$in": scope}, "status": "scheduled"}, {"_id": 0, "payload": 0}
    ).sort("send_at", 1).to_list(100)
    return docs


@router.delete("/team/broadcast/scheduled/{sched_id}", dependencies=[Depends(require_team_access)])
async def cancel_scheduled(sched_id: str, current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    r = await db.scheduled_broadcasts.update_one(
        {"id": sched_id, "user_id": {"$in": scope}, "status": "scheduled"}, {"$set": {"status": "canceled"}}
    )
    if not r.modified_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"canceled": True}


# ---------- inbound replies ----------
@router.get("/team/replies", dependencies=[Depends(require_team_access)])
async def list_replies(current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    docs = await db.sms_messages.find(
        {"user_id": {"$in": scope}, "direction": "in"}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return docs




# ---------- saved message templates ----------
class BroadcastTemplateCreate(BaseModel):
    name: str
    message: str = ""
    links: List[ExternalLink] = Field(default_factory=list)


@router.get("/team/broadcast/templates", dependencies=[Depends(require_team_access)])
async def list_templates(current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    docs = await db.broadcast_templates.find({"user_id": {"$in": scope}}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@router.post("/team/broadcast/templates", dependencies=[Depends(require_team_access)])
async def create_template(payload: BroadcastTemplateCreate, current_user=Depends(get_current_user)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required.")
    doc = {
        "id": secrets.token_urlsafe(9), "user_id": current_user["id"], "name": name,
        "message": (payload.message or "").strip(),
        "links": [l.model_dump() for l in payload.links],
        "created_at": utcnow_iso(),
    }
    await db.broadcast_templates.insert_one({**doc})
    return doc


@router.delete("/team/broadcast/templates/{template_id}", dependencies=[Depends(require_team_access)])
async def delete_template(template_id: str, current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    r = await db.broadcast_templates.delete_one({"id": template_id, "user_id": {"$in": scope}})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True}


# ---------- broadcast history ----------
@router.get("/team/broadcast/history", dependencies=[Depends(require_team_access)])
async def broadcast_history(current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    docs = await db.broadcasts.find({"user_id": {"$in": scope}}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


def _mask(phone: str) -> str:
    return ("•••• " + phone[-4:]) if phone and len(phone) >= 4 else phone


# ============================================================
# Public media (no auth) — play page + raw bytes with range
# ============================================================
@router.get("/public/media/{token}", response_class=HTMLResponse)
async def public_media_page(token: str):
    media = await db.public_media.find_one({"token": token}, {"_id": 0})
    if not media:
        raise HTTPException(status_code=404, detail="Not found")
    raw_url = f"/api/public/media/{token}/raw"
    title = (media.get("title") or "").replace("<", "&lt;").replace(">", "&gt;")
    if media.get("kind") == "music" or (media.get("content_type") or "").startswith("audio"):
        inner = (
            f"<div class='card'><div class='ico'>🎵</div>"
            f"<h1>{title}</h1>"
            f"<audio controls autoplay style='width:100%;margin-top:16px' src='{raw_url}'></audio>"
            f"<p class='hint'>Shared from CheerPlanner</p></div>"
        )
    elif (media.get("content_type") or "").startswith("image"):
        inner = (
            f"<div class='card'><img src='{raw_url}' style='max-width:100%;border-radius:12px'/>"
            f"<p class='hint'>{title}</p></div>"
        )
    else:
        inner = (
            f"<div class='card'><div class='ico'>📎</div><h1>{title}</h1>"
            f"<a class='btn' href='{raw_url}'>Open / Download</a>"
            f"<p class='hint'>Shared from CheerPlanner</p></div>"
        )
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{title}</title><style>"
        "body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0F172A;margin:0;"
        "display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}"
        ".card{background:#fff;border-radius:18px;padding:28px;max-width:420px;width:100%;text-align:center;"
        "box-shadow:0 12px 40px rgba(0,0,0,.3)}.ico{font-size:44px}h1{font-size:20px;color:#0F172A;margin:10px 0}"
        ".hint{color:#94A3B8;font-size:13px;margin-top:16px}"
        ".btn{display:inline-block;margin-top:16px;background:#2563EB;color:#fff;text-decoration:none;"
        "padding:12px 20px;border-radius:10px;font-weight:700}"
        f"</style></head><body>{inner}</body></html>"
    )
    return HTMLResponse(content=html)


@router.get("/public/media/{token}/raw")
async def public_media_raw(token: str, request: Request):
    media = await db.public_media.find_one({"token": token}, {"_id": 0})
    if not media or not media.get("gridfs_id"):
        raise HTTPException(status_code=404, detail="Not found")
    bucket = _music_bucket if media.get("bucket") == "team_music" else _files_bucket
    grid_out = await bucket.open_download_stream(ObjectId(media["gridfs_id"]))
    data = await grid_out.read()
    total = len(data)
    ctype = media.get("content_type") or "application/octet-stream"

    range_header = request.headers.get("range") or request.headers.get("Range")
    if range_header:
        mm = re.match(r"bytes=(\d+)-(\d*)", range_header.strip())
        if mm:
            start = int(mm.group(1))
            end = int(mm.group(2)) if mm.group(2) else total - 1
            start = max(0, min(start, total - 1))
            end = max(start, min(end, total - 1))
            body = data[start:end + 1]
            return Response(content=body, status_code=206, media_type=ctype, headers={
                "Content-Range": f"bytes {start}-{end}/{total}", "Accept-Ranges": "bytes",
                "Content-Length": str(len(body)), "Cache-Control": "public, max-age=3600",
            })
    return Response(content=data, media_type=ctype, headers={
        "Content-Length": str(total), "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600",
    })
