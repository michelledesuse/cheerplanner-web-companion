"""Team Hub group chat.

Phase 1: text-only group thread for team personnel (require_team_access).
Phase 2: supervised MINOR athletes may also join — with their own login linked
to a roster entry — but ONLY after a GUARDIAN (the hub owner OR a caretaker
listed on that athlete's roster entry) approves. Athlete chat is OFF by default,
group-only (there are no private DMs), and every message is visible to the
guardians (who are personnel in the same single group thread).
"""
import secrets
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File, Query, Response, Request
from starlette.concurrency import run_in_threadpool
from datetime import datetime as _dt, timedelta as _td

from core.db import db
from core.security import get_current_user, require_team_access, require_admin
from core.helpers import _resolve_active_household
from core.realtime import _user_from_token
from core.models import utcnow_iso, HouseholdInvite
from core.moderation import assert_clean, FLAG_HIDE_THRESHOLD
from core.storage import put_object, get_object, APP_NAME

router = APIRouter(prefix="/api")

MAX_LEN = 2000


async def _visible_channels(h: dict, user: dict) -> list:
    """Channels in this hub the user may see. Team admins (personnel) see all;
    members see theirs; family members can view athlete channels."""
    admin = bool(user.get("team_access"))
    uid = user["id"]
    fam = set(h.get("member_user_ids") or [])
    out = []
    async for c in db.chat_channels.find({"household_id": h["id"]}, {"_id": 0}).sort("created_at", 1):
        members = c.get("member_user_ids") or []
        if admin or uid in members or (c.get("family_view") and uid in fam):
            out.append(c)
    return out


async def _channel_or_403(cid: str, h: dict, user: dict, need_post: bool = False) -> dict:
    c = await db.chat_channels.find_one({"id": cid, "household_id": h["id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Chat not found.")
    admin = bool(user.get("team_access"))
    uid = user["id"]
    members = c.get("member_user_ids") or []
    if need_post:
        if not (admin or uid in members):
            raise HTTPException(status_code=403, detail="You can view this chat but can't post here.")
    else:
        if not (admin or uid in members or (c.get("family_view") and uid in (h.get("member_user_ids") or []))):
            raise HTTPException(status_code=403, detail="You don't have access to this chat.")
    return c

# Allowed chat media (per user choice: photos, video, music).
_ALLOWED_MEDIA = {
    "image/jpeg": ("image", "jpg"), "image/png": ("image", "png"),
    "image/heic": ("image", "heic"), "image/heif": ("image", "heif"), "image/webp": ("image", "webp"),
    "video/mp4": ("video", "mp4"), "video/quicktime": ("video", "mov"),
    "audio/mpeg": ("audio", "mp3"), "audio/mp4": ("audio", "m4a"), "audio/x-m4a": ("audio", "m4a"),
    "audio/wav": ("audio", "wav"), "audio/x-wav": ("audio", "wav"),
    "audio/aac": ("audio", "aac"), "audio/aacp": ("audio", "aac"), "audio/x-aac": ("audio", "aac"),
}
_MAX_BYTES = {"image": 15 * 1024 * 1024, "video": 90 * 1024 * 1024, "audio": 30 * 1024 * 1024}


async def _blocked_ids(user_id: str) -> set:
    rows = await db.chat_blocks.find({"user_id": user_id}, {"_id": 0, "blocked_user_id": 1}).to_list(5000)
    return {r["blocked_user_id"] for r in rows}


async def _require_chat_guidelines(user_id: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "chat_guidelines_accepted_at": 1})
    if not (u or {}).get("chat_guidelines_accepted_at"):
        raise HTTPException(status_code=403, detail="guidelines_not_accepted")


def _display_name(user: dict) -> str:
    return (user.get("name") or (user.get("email") or "").split("@")[0] or "Member").strip()


def _is_minor(roster: dict) -> bool:
    """Best-effort minor detection: adult_athlete=True => adult; else use DOB
    (age < 18) if present; otherwise treat athletes as minors (safer default)."""
    if roster.get("adult_athlete") is True:
        return False
    dob = roster.get("dob")
    if dob:
        for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y"):
            try:
                d = datetime.strptime(dob.strip()[:10], fmt)
                age = (datetime.utcnow() - d).days / 365.25
                return age < 18
            except Exception:
                continue
    return True


def _guardian_emails(roster: dict) -> set:
    emails = set()
    if roster.get("parent_email"):
        emails.add(roster["parent_email"].lower().strip())
    for ct in (roster.get("caretakers") or []):
        if ct.get("email"):
            emails.add(ct["email"].lower().strip())
    return emails


async def _chat_hub(user_id: str, user: dict) -> Optional[dict]:
    """The hub whose chat this user participates in. Personnel and parents ->
    their active (shared) household. Athlete participants -> the hub they're
    linked to."""
    if user.get("team_access"):
        return await _resolve_active_household(user_id)
    h = await db.households.find_one({"chat_athlete_user_ids": user_id}, {"_id": 0})
    if h:
        return h
    return await _resolve_active_household(user_id)


async def require_chat_access(current_user=Depends(get_current_user)) -> dict:
    """Allow team personnel and parents (household members), plus an athlete
    whose guardian has APPROVED chat. Minor athletes are gated on approval;
    everyone else (coaches/staff + parents) participates in the team thread."""
    if current_user.get("team_access"):
        return current_user
    h = await db.households.find_one({"chat_athlete_user_ids": current_user["id"]}, {"_id": 0, "id": 1})
    if h:
        link = await db.athlete_chat_links.find_one(
            {"household_id": h["id"], "athlete_user_id": current_user["id"]}, {"_id": 0, "chat_enabled": 1}
        )
        if link and link.get("chat_enabled"):
            return current_user
        raise HTTPException(status_code=403, detail="Your parent/guardian hasn't approved Team Chat yet.")
    # Parent / household member — allowed into the team thread + named channels.
    return current_user


async def _participant_users(h: dict) -> list:
    """All chat participants of a hub: personnel + owner + APPROVED athletes."""
    ids = set(h.get("member_user_ids") or []) | set(h.get("team_hub_member_user_ids") or [])
    if h.get("owner_user_id"):
        ids.add(h["owner_user_id"])
    async for l in db.athlete_chat_links.find({"household_id": h["id"], "chat_enabled": True}, {"_id": 0, "athlete_user_id": 1}):
        if l.get("athlete_user_id"):
            ids.add(l["athlete_user_id"])
    out = []
    for uid in ids:
        u = await db.users.find_one({"id": uid}, {"_id": 0, "name": 1, "email": 1})
        if u:
            out.append({"user_id": uid, "name": u.get("name") or (u.get("email") or "").split("@")[0] or "Member"})
    out.sort(key=lambda x: x["name"].lower())
    return out


@router.get("/team/chat/participants")
async def list_participants(current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"participants": []}
    return {"participants": [p for p in await _participant_users(h) if p["user_id"] != current_user["id"]]}


@router.get("/team/chat/receipts")
async def read_receipts(current_user=Depends(require_chat_access)):
    """Per-participant last_read_at so the sender can see who's caught up."""
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"receipts": []}
    parts = await _participant_users(h)
    reads = {}
    async for r in db.chat_reads.find({"household_id": h["id"]}, {"_id": 0, "user_id": 1, "last_read_at": 1}):
        reads[r["user_id"]] = r.get("last_read_at")
    for p in parts:
        p["last_read_at"] = reads.get(p["user_id"])
    return {"receipts": parts}


# ---------------------------------------------------------------- messages ---
@router.get("/team/chat/messages")
async def list_messages(before: Optional[str] = None, limit: int = 40, current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"messages": [], "me": current_user["id"], "has_more": False, "supervised": False}
    limit = max(1, min(int(limit or 40), 100))
    q: dict = {"household_id": h["id"], "hidden": {"$ne": True}, "channel_id": None}
    blocked = await _blocked_ids(current_user["id"])
    if blocked:
        q["sender_id"] = {"$nin": list(blocked)}
    if before:
        q["created_at"] = {"$lt": before}
    docs = await db.team_messages.find(q, {"_id": 0}).sort("created_at", -1).limit(limit + 1).to_list(limit + 1)
    has_more = len(docs) > limit
    docs = docs[:limit]
    docs.reverse()
    supervised = current_user["id"] in (h.get("chat_athlete_user_ids") or [])
    gu = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "chat_guidelines_accepted_at": 1})
    return {
        "messages": docs, "me": current_user["id"], "has_more": has_more,
        "supervised": supervised,
        "can_moderate": bool(current_user.get("team_access") or current_user.get("is_admin")),
        "guidelines_accepted": bool((gu or {}).get("chat_guidelines_accepted_at")),
    }


@router.post("/team/chat/messages")
async def post_message(payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    text = (payload.get("text") or "").strip()[:MAX_LEN]
    media_id = (payload.get("media_id") or "").strip()
    if not text and not media_id:
        raise HTTPException(status_code=400, detail="Message can't be empty.")
    await _require_chat_guidelines(current_user["id"])  # Apple 1.2 content agreement
    if text:
        assert_clean(text)  # objectionable-language filter
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        raise HTTPException(status_code=403, detail="No chat available.")
    media = []
    if media_id:
        mrec = await db.chat_media.find_one(
            {"id": media_id, "household_id": h["id"], "owner_id": current_user["id"]}, {"_id": 0}
        )
        if not mrec:
            raise HTTPException(status_code=400, detail="Attachment not found.")
        media = [{"id": mrec["id"], "kind": mrec["kind"], "content_type": mrec["content_type"], "name": mrec.get("name")}]
    # @mentions — keep only ids that are real participants.
    mentions_in = payload.get("mentions") or []
    valid_ids = {p["user_id"] for p in await _participant_users(h)}
    mentions = [uid for uid in mentions_in if uid in valid_ids][:20]
    now = utcnow_iso()
    doc = {
        "id": secrets.token_urlsafe(9), "household_id": h["id"],
        "sender_id": current_user["id"], "sender_name": _display_name(current_user),
        "text": text, "media": media, "reactions": {}, "mentions": mentions, "created_at": now,
    }
    await db.team_messages.insert_one(dict(doc))
    await db.chat_reads.update_one(
        {"household_id": h["id"], "user_id": current_user["id"]},
        {"$set": {"last_read_at": now}}, upsert=True,
    )
    return doc


@router.post("/team/chat/read")
async def mark_read(current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"ok": True}
    now = utcnow_iso()
    await db.chat_reads.update_one(
        {"household_id": h["id"], "user_id": current_user["id"]},
        {"$set": {"last_read_at": now}}, upsert=True,
    )
    return {"ok": True, "last_read_at": now}


@router.get("/team/chat/unread")
async def unread_count(current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"unread": 0}
    r = await db.chat_reads.find_one(
        {"household_id": h["id"], "user_id": current_user["id"]}, {"_id": 0, "last_read_at": 1}
    )
    last = (r or {}).get("last_read_at") or ""
    q: dict = {"household_id": h["id"], "channel_id": None, "sender_id": {"$ne": current_user["id"]}}
    if last:
        q["created_at"] = {"$gt": last}
    return {"unread": await db.team_messages.count_documents(q)}


# --------------------------------------------------- moderation (Phase 4) ---
@router.post("/team/chat/accept-guidelines")
async def accept_chat_guidelines(current_user=Depends(get_current_user)):
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"chat_guidelines_accepted_at": utcnow_iso()}})
    return {"accepted": True}


@router.post("/team/chat/messages/{message_id}/flag")
async def flag_message(message_id: str, payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    """Report a message. Auto-hidden from everyone once distinct reports hit the
    threshold; admins can review the queue and remove permanently."""
    h = await _chat_hub(current_user["id"], current_user)
    m = await db.team_messages.find_one({"id": message_id, "household_id": (h or {}).get("id")}, {"_id": 0, "id": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Message not found.")
    await db.chat_message_flags.update_one(
        {"message_id": message_id, "user_id": current_user["id"]},
        {"$set": {"reason": (payload.get("reason") or "").strip()[:300], "created_at": utcnow_iso()},
         "$setOnInsert": {"id": secrets.token_urlsafe(9), "household_id": h["id"]}},
        upsert=True,
    )
    n = await db.chat_message_flags.count_documents({"message_id": message_id})
    if n >= FLAG_HIDE_THRESHOLD:
        await db.team_messages.update_one({"id": message_id}, {"$set": {"hidden": True}})
    return {"flagged": True}


@router.post("/team/chat/block")
async def block_member(payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    """Hide all messages from another member for the requesting user."""
    target = (payload.get("user_id") or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="Missing user_id.")
    if target == current_user["id"]:
        raise HTTPException(status_code=400, detail="You can't block yourself.")
    await db.chat_blocks.update_one(
        {"user_id": current_user["id"], "blocked_user_id": target},
        {"$set": {"created_at": utcnow_iso()}}, upsert=True,
    )
    return {"blocked": True}


@router.post("/team/chat/unblock")
async def unblock_member(payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    target = (payload.get("user_id") or "").strip()
    await db.chat_blocks.delete_one({"user_id": current_user["id"], "blocked_user_id": target})
    return {"unblocked": True}


@router.get("/team/chat/blocks")
async def list_blocks(current_user=Depends(require_chat_access)):
    rows = await db.chat_blocks.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(1000)
    out = []
    for r in rows:
        u = await db.users.find_one({"id": r["blocked_user_id"]}, {"_id": 0, "name": 1, "email": 1})
        out.append({
            "user_id": r["blocked_user_id"],
            "name": (u or {}).get("name") or ((u or {}).get("email") or "").split("@")[0] or "Member",
            "blocked_at": r.get("created_at"),
        })
    return {"blocks": out}


@router.delete("/team/chat/messages/{message_id}")
async def delete_message(message_id: str, current_user=Depends(require_chat_access)):
    """Message removal:
    - the sender can always delete their own message;
    - a TEAM ADMIN (team_access) can remove ANY message in their own hub;
    - a platform admin can remove any message.
    (Satisfies Apple 1.2's 'act on reports within 24h'.)"""
    m = await db.team_messages.find_one({"id": message_id}, {"_id": 0, "sender_id": 1, "household_id": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Message not found.")
    allowed = m["sender_id"] == current_user["id"] or current_user.get("is_admin")
    if not allowed and current_user.get("team_access"):
        h = await _chat_hub(current_user["id"], current_user)
        allowed = bool(h) and m.get("household_id") == h["id"]
    if not allowed:
        raise HTTPException(status_code=403, detail="You can only delete your own message.")
    await db.team_messages.delete_one({"id": message_id})
    await db.chat_message_flags.delete_many({"message_id": message_id})
    return {"deleted": True}


@router.get("/team/chat/flags", dependencies=[Depends(require_admin)])
async def list_chat_flags():
    flags = await db.chat_message_flags.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    out = []
    for f in flags:
        msg = await db.team_messages.find_one({"id": f["message_id"]}, {"_id": 0})
        if not msg:
            continue
        out.append({"flag": f, "message": msg})
    return {"flags": out}


# ------------------------------------------------------- media (Phase 3) ---
@router.post("/team/chat/media")
async def upload_media(file: UploadFile = File(...), current_user=Depends(require_chat_access)):
    ctype = (file.content_type or "").lower().split(";")[0].strip()
    if ctype not in _ALLOWED_MEDIA:
        raise HTTPException(status_code=400, detail="That file type isn't supported.")
    kind, ext = _ALLOWED_MEDIA[ctype]
    data = await file.read()
    if len(data) > _MAX_BYTES[kind]:
        raise HTTPException(status_code=413, detail=f"That {kind} is too large.")
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        raise HTTPException(status_code=403, detail="No chat available.")
    media_id = secrets.token_urlsafe(10)
    path = f"{APP_NAME}/chat/{h['id']}/{current_user['id']}/{uuid.uuid4()}.{ext}"
    try:
        await run_in_threadpool(put_object, path, data, ctype)
    except Exception as e:  # noqa: BLE001
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status == 402:
            raise HTTPException(status_code=402, detail="Storage limit reached. Please try again later.")
        raise HTTPException(status_code=502, detail="Upload failed. Please try again.")
    await db.chat_media.insert_one({
        "id": media_id, "household_id": h["id"], "owner_id": current_user["id"],
        "storage_path": path, "content_type": ctype, "kind": kind,
        "name": (file.filename or f"{kind}.{ext}")[:120], "size": len(data), "created_at": utcnow_iso(),
    })
    return {"media_id": media_id, "kind": kind, "content_type": ctype, "name": file.filename}


@router.get("/team/chat/media/{media_id}")
async def serve_media(media_id: str, request: Request, token: str = Query(...)):
    """Serve chat media to authorized participants only. Supports HTTP Range so
    iOS/Android video & audio players can stream (they require 206 responses)."""
    user = await _user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authorized.")
    rec = await db.chat_media.find_one({"id": media_id}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Not found.")
    h = await db.households.find_one({"id": rec["household_id"]}, {"_id": 0})
    participants = set((h or {}).get("member_user_ids") or []) | set((h or {}).get("team_hub_member_user_ids") or []) | set((h or {}).get("chat_athlete_user_ids") or [])
    if (h or {}).get("owner_user_id"):
        participants.add(h["owner_user_id"])
    if user["id"] not in participants:
        raise HTTPException(status_code=403, detail="Not authorized.")
    content, ctype = await run_in_threadpool(get_object, rec["storage_path"])
    ctype = ctype or rec["content_type"]
    total = len(content)
    rng = request.headers.get("range") or request.headers.get("Range")
    if rng and rng.startswith("bytes="):
        try:
            start_s, end_s = rng.split("=", 1)[1].split("-", 1)
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else total - 1
            start = max(0, start); end = min(end, total - 1)
            if start <= end:
                chunk = content[start:end + 1]
                return Response(content=chunk, status_code=206, media_type=ctype, headers={
                    "Content-Range": f"bytes {start}-{end}/{total}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(len(chunk)),
                    "Cache-Control": "private, max-age=86400",
                })
        except Exception:
            pass
    return Response(content=content, media_type=ctype, headers={
        "Accept-Ranges": "bytes", "Content-Length": str(total), "Cache-Control": "private, max-age=86400",
    })


# ---------------------------------------------------- reactions (Phase 3) ---
@router.post("/team/chat/messages/{message_id}/react")
async def react_message(message_id: str, payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    emoji = (payload.get("emoji") or "").strip()[:8]
    if not emoji:
        raise HTTPException(status_code=400, detail="Missing emoji.")
    h = await _chat_hub(current_user["id"], current_user)
    m = await db.team_messages.find_one({"id": message_id, "household_id": (h or {}).get("id")}, {"_id": 0, "id": 1, "reactions": 1})
    if m is None:
        raise HTTPException(status_code=404, detail="Message not found.")
    reactions = m.get("reactions") or {}
    users = set(reactions.get(emoji) or [])
    uid = current_user["id"]
    if uid in users:
        users.discard(uid)
    else:
        users.add(uid)
    if users:
        reactions[emoji] = sorted(users)
    else:
        reactions.pop(emoji, None)
    await db.team_messages.update_one({"id": message_id}, {"$set": {"reactions": reactions}})
    return {"reactions": reactions}


# ------------------------------------------------- athlete access (Phase 2) ---
@router.get("/team/chat/athletes")
async def list_chat_athletes(current_user=Depends(require_team_access)):
    """Roster athletes and their chat-access status (for the management screen)."""
    h = await _resolve_active_household(current_user["id"])
    owner_id = h.get("owner_user_id") or (h.get("member_user_ids") or [None])[0]
    scope_ids = list(set((h.get("member_user_ids") or []) + [owner_id] + (h.get("team_hub_member_user_ids") or [])))
    my_email = (current_user.get("email") or "").lower().strip()
    is_owner = current_user["id"] == owner_id
    links = {l["roster_id"]: l async for l in db.athlete_chat_links.find({"household_id": h["id"]}, {"_id": 0})}
    out = []
    async for m in db.roster.find({"user_id": {"$in": scope_ids}, "role": "athlete"}, {"_id": 0}):
        link = links.get(m["id"]) or {}
        is_guardian = is_owner or (my_email and my_email in _guardian_emails(m))
        out.append({
            "roster_id": m["id"],
            "name": m.get("name") or ((m.get("first_name") or "") + " " + (m.get("last_name") or "")).strip(),
            "is_minor": _is_minor(m),
            "linked": bool(link.get("athlete_user_id")),
            "chat_enabled": bool(link.get("chat_enabled")),
            "invite_code": link.get("invite_code") if not link.get("athlete_user_id") else None,
            "guardian_emails": sorted(_guardian_emails(m)),
            "can_approve": bool(is_guardian),
        })
    return {"athletes": out, "is_owner": is_owner}


@router.post("/team/chat/athletes/{roster_id}/invite")
async def invite_athlete(roster_id: str, current_user=Depends(require_team_access)):
    """Create/refresh a chat invite code for an athlete's login. Any personnel
    can invite; a GUARDIAN must still approve before the athlete can chat."""
    h = await _resolve_active_household(current_user["id"])
    owner_id = h.get("owner_user_id") or (h.get("member_user_ids") or [None])[0]
    scope_ids = list(set((h.get("member_user_ids") or []) + [owner_id] + (h.get("team_hub_member_user_ids") or [])))
    m = await db.roster.find_one({"id": roster_id, "user_id": {"$in": scope_ids}, "role": "athlete"}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Athlete not found on this roster.")
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = "".join(secrets.choice(alphabet) for _ in range(6))
    expires = (_dt.utcnow() + _td(days=14)).isoformat() + "Z"
    invite = HouseholdInvite(
        household_id=h["id"], invited_by=current_user["id"], code=code, expires_at=expires,
        grant_chat_athlete=True, roster_id=roster_id,
    ).model_dump()
    await db.household_invites.insert_one(invite)
    await db.athlete_chat_links.update_one(
        {"household_id": h["id"], "roster_id": roster_id},
        {"$set": {"invite_code": code, "invited_by": current_user["id"], "invited_at": utcnow_iso()},
         "$setOnInsert": {"chat_enabled": False, "created_at": utcnow_iso()}},
        upsert=True,
    )
    return {"code": code, "expires_at": expires, "roster_id": roster_id}


@router.post("/team/chat/athletes/{roster_id}/approve")
async def approve_athlete(roster_id: str, payload: dict = Body(default={}), current_user=Depends(require_team_access)):
    """Guardian-only: turn a linked athlete's chat access ON/OFF."""
    h = await _resolve_active_household(current_user["id"])
    owner_id = h.get("owner_user_id") or (h.get("member_user_ids") or [None])[0]
    scope_ids = list(set((h.get("member_user_ids") or []) + [owner_id] + (h.get("team_hub_member_user_ids") or [])))
    m = await db.roster.find_one({"id": roster_id, "user_id": {"$in": scope_ids}, "role": "athlete"}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Athlete not found on this roster.")
    my_email = (current_user.get("email") or "").lower().strip()
    is_guardian = current_user["id"] == owner_id or (my_email and my_email in _guardian_emails(m))
    if not is_guardian:
        raise HTTPException(status_code=403, detail="Only the athlete's parent/guardian (or account owner) can approve chat.")
    link = await db.athlete_chat_links.find_one({"household_id": h["id"], "roster_id": roster_id}, {"_id": 0})
    if not link or not link.get("athlete_user_id"):
        raise HTTPException(status_code=400, detail="This athlete hasn't set up their login yet.")
    enabled = bool(payload.get("enabled", True))
    await db.athlete_chat_links.update_one(
        {"household_id": h["id"], "roster_id": roster_id},
        {"$set": {"chat_enabled": enabled, "approved_by": current_user["id"], "approved_at": utcnow_iso()}},
    )
    return {"roster_id": roster_id, "chat_enabled": enabled}


@router.get("/team/chat/family-members")
async def family_members(current_user=Depends(require_team_access)):
    """Existing logins in this family/household — so an athlete who already has a
    family account can be added to chat directly (no invite code needed)."""
    h = await _resolve_active_household(current_user["id"])
    owner_id = h.get("owner_user_id") or (h.get("member_user_ids") or [None])[0]
    linked = set()
    async for l in db.athlete_chat_links.find({"household_id": h["id"]}, {"_id": 0, "athlete_user_id": 1}):
        if l.get("athlete_user_id"):
            linked.add(l["athlete_user_id"])
    out = []
    for uid in (h.get("member_user_ids") or []):
        u = await db.users.find_one({"id": uid}, {"_id": 0, "name": 1, "email": 1})
        if not u:
            continue
        out.append({
            "user_id": uid,
            "name": u.get("name") or (u.get("email") or "").split("@")[0] or "Member",
            "email": u.get("email"),
            "is_owner": uid == owner_id,
            "already_in_chat": uid in linked,
        })
    return {"members": out}


@router.post("/team/chat/athletes/{roster_id}/link-member")
async def link_existing_member(roster_id: str, payload: dict = Body(default={}), current_user=Depends(require_team_access)):
    """Guardian-only: link an EXISTING family-account login to a roster athlete
    and turn on their supervised chat in one step (skips the invite code)."""
    h = await _resolve_active_household(current_user["id"])
    owner_id = h.get("owner_user_id") or (h.get("member_user_ids") or [None])[0]
    scope_ids = list(set((h.get("member_user_ids") or []) + [owner_id] + (h.get("team_hub_member_user_ids") or [])))
    m = await db.roster.find_one({"id": roster_id, "user_id": {"$in": scope_ids}, "role": "athlete"}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Athlete not found on this roster.")
    my_email = (current_user.get("email") or "").lower().strip()
    if not (current_user["id"] == owner_id or (my_email and my_email in _guardian_emails(m))):
        raise HTTPException(status_code=403, detail="Only the athlete's parent/guardian (or account owner) can add them to chat.")
    target = (payload.get("user_id") or "").strip()
    if target not in (h.get("member_user_ids") or []):
        raise HTTPException(status_code=400, detail="That person isn't a member of this family account.")
    now = utcnow_iso()
    await db.households.update_one({"id": h["id"]}, {"$addToSet": {"chat_athlete_user_ids": target}})
    await db.athlete_chat_links.update_one(
        {"household_id": h["id"], "roster_id": roster_id},
        {"$set": {"athlete_user_id": target, "chat_enabled": True, "linked_at": now,
                  "approved_by": current_user["id"], "approved_at": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"linked": True, "chat_enabled": True, "athlete_user_id": target}



# --------------------------------------------------- named chats (channels) ---
@router.get("/team/chat/channels")
async def list_channels(current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        return {"channels": []}
    chans = await _visible_channels(h, current_user)
    parts = {p["user_id"]: p["name"] for p in await _participant_users(h)}
    out = []
    for c in chans:
        names = [parts.get(uid, "Member") for uid in (c.get("member_user_ids") or [])]
        out.append({"id": c["id"], "name": c["name"], "kind": c.get("kind", "team"),
                    "member_count": len(c.get("member_user_ids") or []), "member_names": names[:6]})
    return {"channels": out}


@router.post("/team/chat/channels")
async def create_channel(payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    name = (payload.get("name") or "").strip()[:60]
    if not name:
        raise HTTPException(status_code=400, detail="Give the chat a name.")
    h = await _chat_hub(current_user["id"], current_user)
    if not h:
        raise HTTPException(status_code=403, detail="No chat available.")
    valid = {p["user_id"] for p in await _participant_users(h)}
    members = [u for u in (payload.get("member_ids") or []) if u in valid]
    members = list(set(members + [current_user["id"]]))
    athletes = set(h.get("chat_athlete_user_ids") or [])
    kind = "athlete" if any(m in athletes for m in members) else "team"
    doc = {
        "id": secrets.token_urlsafe(8), "household_id": h["id"], "name": name,
        "kind": kind, "member_user_ids": members, "created_by": current_user["id"],
        # Athlete chats are viewable by the family (parents/guardians) per policy.
        "family_view": kind == "athlete", "created_at": utcnow_iso(),
    }
    await db.chat_channels.insert_one(dict(doc))
    return {"id": doc["id"], "name": name, "kind": kind, "member_count": len(members)}


@router.get("/team/chat/channels/{cid}/messages")
async def channel_messages(cid: str, before: Optional[str] = None, limit: int = 40, current_user=Depends(require_chat_access)):
    h = await _chat_hub(current_user["id"], current_user)
    await _channel_or_403(cid, h, current_user)
    limit = max(1, min(int(limit or 40), 100))
    q: dict = {"household_id": h["id"], "channel_id": cid, "hidden": {"$ne": True}}
    blocked = await _blocked_ids(current_user["id"])
    if blocked:
        q["sender_id"] = {"$nin": list(blocked)}
    if before:
        q["created_at"] = {"$lt": before}
    docs = await db.team_messages.find(q, {"_id": 0}).sort("created_at", -1).limit(limit + 1).to_list(limit + 1)
    has_more = len(docs) > limit
    docs = docs[:limit]
    docs.reverse()
    return {"messages": docs, "me": current_user["id"], "has_more": has_more, "supervised": current_user["id"] in (h.get("chat_athlete_user_ids") or []), "can_moderate": bool(current_user.get("team_access") or current_user.get("is_admin"))}


@router.post("/team/chat/channels/{cid}/messages")
async def channel_post(cid: str, payload: dict = Body(default={}), current_user=Depends(require_chat_access)):
    text = (payload.get("text") or "").strip()[:MAX_LEN]
    media_id = (payload.get("media_id") or "").strip()
    if not text and not media_id:
        raise HTTPException(status_code=400, detail="Message can't be empty.")
    await _require_chat_guidelines(current_user["id"])
    if text:
        assert_clean(text)
    h = await _chat_hub(current_user["id"], current_user)
    await _channel_or_403(cid, h, current_user, need_post=True)
    media = []
    if media_id:
        mrec = await db.chat_media.find_one({"id": media_id, "household_id": h["id"], "owner_id": current_user["id"]}, {"_id": 0})
        if not mrec:
            raise HTTPException(status_code=400, detail="Attachment not found.")
        media = [{"id": mrec["id"], "kind": mrec["kind"], "content_type": mrec["content_type"], "name": mrec.get("name")}]
    valid = {p["user_id"] for p in await _participant_users(h)}
    mentions = [u for u in (payload.get("mentions") or []) if u in valid][:20]
    now = utcnow_iso()
    doc = {"id": secrets.token_urlsafe(9), "household_id": h["id"], "channel_id": cid,
           "sender_id": current_user["id"], "sender_name": _display_name(current_user),
           "text": text, "media": media, "reactions": {}, "mentions": mentions, "created_at": now}
    await db.team_messages.insert_one(dict(doc))
    return doc

