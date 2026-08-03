"""Team Music (Team Hub) — upload audio and share it with the team.

Files can be a few MB, so uploads are CHUNKED (base64 chunks buffered in a
temp collection, then assembled into GridFS on finish). Playback streams from
GridFS via a token-authenticated GET so expo-audio can load the URL directly.
"""
import base64
import re
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Body, Request
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from core.db import db
from core.models import TeamTrack, TeamTrackInit, TeamTrackUpdate
from core.security import get_current_user, require_team_access
from core.helpers import _team_hub_scope_user_ids
from core.realtime import _user_from_token

router = APIRouter(prefix="/api")

_bucket = AsyncIOMotorGridFSBucket(db, bucket_name="team_music")

MAX_TRACK_BYTES = 15 * 1024 * 1024  # 15 MB per track


def _full_name(u: dict) -> str:
    n = f"{u.get('first_name') or ''} {u.get('last_name') or ''}".strip()
    return n or (u.get("email") or "").split("@")[0] or "Someone"


@router.get("/team/music", response_model=List[TeamTrack], dependencies=[Depends(require_team_access)])
async def list_music(team_id: Optional[str] = None, competition_id: Optional[str] = None,
                     current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    q = {"user_id": {"$in": scope}, "status": "ready"}
    if team_id:
        q["team_ids"] = team_id
    if competition_id:
        q["competition_ids"] = competition_id
    docs = await db.team_music.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [TeamTrack(**d) for d in docs]


@router.post("/team/music/init", dependencies=[Depends(require_team_access)])
async def init_upload(payload: TeamTrackInit, current_user=Depends(get_current_user)):
    track = TeamTrack(
        user_id=current_user["id"],
        title=(payload.title or "Untitled").strip()[:120] or "Untitled",
        filename=payload.filename,
        content_type=payload.content_type or "audio/mpeg",
        team_ids=payload.team_ids or [],
        competition_ids=payload.competition_ids or [],
        uploaded_by_name=_full_name(current_user),
        status="uploading",
    )
    await db.team_music.insert_one(track.model_dump())
    return {"track_id": track.id}


@router.post("/team/music/{track_id}/chunk", dependencies=[Depends(require_team_access)])
async def upload_chunk(track_id: str, payload: dict = Body(...), current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    track = await db.team_music.find_one({"id": track_id, "user_id": {"$in": scope}}, {"_id": 0})
    if not track:
        raise HTTPException(status_code=404, detail="Upload not found")
    idx = payload.get("index")
    data = payload.get("data")
    if idx is None or data is None:
        raise HTTPException(status_code=400, detail="index and data required")
    await db.music_chunks.update_one(
        {"track_id": track_id, "index": int(idx)},
        {"$set": {"track_id": track_id, "index": int(idx), "data": str(data)}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/team/music/{track_id}/finish", response_model=TeamTrack, dependencies=[Depends(require_team_access)])
async def finish_upload(track_id: str, current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    track = await db.team_music.find_one({"id": track_id, "user_id": {"$in": scope}}, {"_id": 0})
    if not track:
        raise HTTPException(status_code=404, detail="Upload not found")
    chunks = await db.music_chunks.find({"track_id": track_id}, {"_id": 0}).sort("index", 1).to_list(2000)
    if not chunks:
        raise HTTPException(status_code=400, detail="No audio received")
    buf = bytearray()
    for c in chunks:
        try:
            buf.extend(base64.b64decode(c["data"]))
        except Exception:
            raise HTTPException(status_code=400, detail="Corrupt upload chunk")
        if len(buf) > MAX_TRACK_BYTES:
            await db.music_chunks.delete_many({"track_id": track_id})
            await db.team_music.delete_one({"id": track_id})
            raise HTTPException(status_code=400, detail="Track is too large (max 15 MB).")
    gid = await _bucket.upload_from_stream(track.get("filename") or track["title"], bytes(buf))
    await db.music_chunks.delete_many({"track_id": track_id})
    await db.team_music.update_one(
        {"id": track_id},
        {"$set": {"gridfs_id": str(gid), "size": len(buf), "status": "ready"}},
    )
    doc = await db.team_music.find_one({"id": track_id}, {"_id": 0})
    return TeamTrack(**doc)


@router.patch("/team/music/{track_id}", response_model=TeamTrack, dependencies=[Depends(require_team_access)])
async def update_track(track_id: str, payload: TeamTrackUpdate, current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    updates = {}
    sent = payload.model_dump(exclude_unset=True)
    if "title" in sent and sent["title"] is not None:
        updates["title"] = sent["title"].strip()[:120] or "Untitled"
    if "team_ids" in sent and sent["team_ids"] is not None:
        updates["team_ids"] = sent["team_ids"]
    if "competition_ids" in sent and sent["competition_ids"] is not None:
        updates["competition_ids"] = sent["competition_ids"]
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.team_music.update_one({"id": track_id, "user_id": {"$in": scope}}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Track not found")
    doc = await db.team_music.find_one({"id": track_id}, {"_id": 0})
    return TeamTrack(**doc)


@router.delete("/team/music/{track_id}", dependencies=[Depends(require_team_access)])
async def delete_track(track_id: str, current_user=Depends(get_current_user)):
    scope = await _team_hub_scope_user_ids(current_user["id"])
    track = await db.team_music.find_one({"id": track_id, "user_id": {"$in": scope}}, {"_id": 0})
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    if track.get("gridfs_id"):
        try:
            await _bucket.delete(ObjectId(track["gridfs_id"]))
        except Exception:
            pass
    await db.music_chunks.delete_many({"track_id": track_id})
    await db.team_music.delete_one({"id": track_id})
    return {"deleted": True}


@router.get("/team/music/{track_id}/stream")
async def stream_track(track_id: str, token: str, request: Request):
    """Token-authenticated streaming with HTTP Range support.

    iOS AVPlayer (expo-audio) requires byte-range support to play remote audio,
    so we honor the Range header and return 206 Partial Content. Tracks are
    <=15 MB, so we read the file once and slice in memory.
    """
    u = await _user_from_token(token)
    if not u:
        raise HTTPException(status_code=401, detail="Not authorized")
    user = await db.users.find_one({"id": u["id"]}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("team_access"):
        raise HTTPException(status_code=401, detail="Not authorized")
    scope = await _team_hub_scope_user_ids(user["id"])
    track = await db.team_music.find_one(
        {"id": track_id, "user_id": {"$in": scope}, "status": "ready"}, {"_id": 0}
    )
    if not track or not track.get("gridfs_id"):
        raise HTTPException(status_code=404, detail="Track not found")
    grid_out = await _bucket.open_download_stream(ObjectId(track["gridfs_id"]))
    data = await grid_out.read()
    total = len(data)
    ctype = track.get("content_type") or "audio/mpeg"

    range_header = request.headers.get("range") or request.headers.get("Range")
    if range_header:
        m = re.match(r"bytes=(\d+)-(\d*)", range_header.strip())
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else total - 1
            start = max(0, min(start, total - 1))
            end = max(start, min(end, total - 1))
            body = data[start:end + 1]
            return Response(
                content=body,
                status_code=206,
                media_type=ctype,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{total}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(len(body)),
                    "Cache-Control": "private, max-age=3600",
                },
            )

    return Response(
        content=data,
        media_type=ctype,
        headers={
            "Content-Length": str(total),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=3600",
        },
    )
