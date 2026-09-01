"""CheerPlanner AI Designer (Team Hub) — coach/staff only.

A simple, reliable text-to-image experience powered by OpenAI's GPT-Image-2
model, using the account's own OpenAI API key (kept server-side only).

v1 scope: generate from a natural-language prompt, regenerate, save to an
in-app designs library, and download/share. Built to extend later with
reference images, logo uploads, edits, transparent backgrounds and variations.

Access is gated by require_team_access, so athletes and parents cannot use it.
"""
import base64
import io
import os
import secrets
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException
from starlette.concurrency import run_in_threadpool
from PIL import Image

from core.db import db
from core.security import require_team_access
from core.helpers import _resolve_active_household
from core.models import utcnow_iso
from core.moderation import assert_clean
from core.storage import put_object, delete_object, APP_NAME

router = APIRouter(prefix="/api")

IMAGE_MODEL = os.environ.get("AI_DESIGNER_MODEL", "gpt-image-2")
ALLOWED_SIZES = {"1024x1024", "1536x1024", "1024x1536", "auto"}


def _openai_generate(prompt: str, size: str) -> bytes:
    """Call OpenAI GPT-Image-2 and return raw PNG bytes. Runs in a threadpool
    because the OpenAI SDK is synchronous."""
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = client.images.generate(model=IMAGE_MODEL, prompt=prompt, size=size, n=1)
    b64 = resp.data[0].b64_json
    if not b64:
        raise RuntimeError("No image returned.")
    return base64.b64decode(b64)


def _thumb(data: bytes, box: int = 400) -> str:
    """Small data-URL thumbnail for the designs gallery."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((box, box))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("utf-8")


@router.post("/ai-designer/generate")
async def generate_design(payload: dict = Body(...), user=Depends(require_team_access)):
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Describe what you'd like to create.")
    if len(prompt) > 4000:
        prompt = prompt[:4000]
    assert_clean(prompt)
    size = payload.get("size") if payload.get("size") in ALLOWED_SIZES else "1024x1024"
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="AI Designer isn't configured yet. Add your OpenAI API key.")
    try:
        data = await run_in_threadpool(_openai_generate, prompt, size)
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if "verif" in msg or ("model" in msg and ("not" in msg or "access" in msg)) or "must be verified" in msg:
            raise HTTPException(status_code=503, detail="Your OpenAI organization needs to be verified to use GPT-Image-2. Finish verification in your OpenAI console, then try again.")
        if "content_policy" in msg or "safety" in msg or "rejected" in msg:
            raise HTTPException(status_code=400, detail="That request was rejected by the safety filter. Try describing something else.")
        if "insufficient_quota" in msg or "billing" in msg or "exceeded your current quota" in msg:
            raise HTTPException(status_code=402, detail="Your OpenAI account is out of credit or over its quota. Add billing in your OpenAI console.")
        if "rate limit" in msg or "429" in msg:
            raise HTTPException(status_code=429, detail="OpenAI is rate-limiting right now. Please try again in a moment.")
        if "api key" in msg or "401" in msg or "authentication" in msg or "incorrect api key" in msg:
            raise HTTPException(status_code=503, detail="Your OpenAI API key was rejected. Please check the key.")
        raise HTTPException(status_code=502, detail="Couldn't generate the design. Please try again.")
    return {"image_base64": base64.b64encode(data).decode("utf-8"), "prompt": prompt, "size": size}


@router.post("/ai-designer/save")
async def save_design(payload: dict = Body(...), user=Depends(require_team_access)):
    """Save a generated design to the in-app designs library."""
    b64 = payload.get("image_base64") or ""
    if not b64:
        raise HTTPException(status_code=400, detail="Nothing to save.")
    try:
        data = base64.b64decode(b64)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid image data.")
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=400, detail="No team hub found.")
    design_id = secrets.token_urlsafe(10)
    path = f"{APP_NAME}/ai_designer/{h['id']}/{user['id']}/{uuid.uuid4()}.png"
    try:
        await run_in_threadpool(put_object, path, data, "image/png")
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Couldn't save the design. Please try again.")
    try:
        thumb = await run_in_threadpool(_thumb, data)
    except Exception:  # noqa: BLE001
        thumb = ""
    await db.ai_designs.insert_one({
        "id": design_id, "household_id": h["id"], "owner_id": user["id"], "storage_path": path,
        "prompt": (payload.get("prompt") or "")[:500], "thumb": thumb,
        "size": payload.get("size") or "1024x1024", "created_at": utcnow_iso(),
    })
    return {"design_id": design_id}


@router.get("/ai-designer/designs")
async def list_designs(user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        return {"designs": []}
    rows = await db.ai_designs.find(
        {"household_id": h["id"]}, {"_id": 0, "id": 1, "prompt": 1, "thumb": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(200)
    return {"designs": rows}


@router.get("/ai-designer/designs/{design_id}")
async def get_design(design_id: str, user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=404, detail="Not found.")
    rec = await db.ai_designs.find_one({"id": design_id, "household_id": h["id"]}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Design not found.")
    from core.storage import get_object
    content, _ = await run_in_threadpool(get_object, rec["storage_path"])
    return {"image_base64": base64.b64encode(content).decode("utf-8"), "prompt": rec.get("prompt", ""), "size": rec.get("size", "")}


@router.delete("/ai-designer/designs/{design_id}")
async def delete_design(design_id: str, user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=404, detail="No team hub found.")
    rec = await db.ai_designs.find_one({"id": design_id, "household_id": h["id"]}, {"_id": 0, "storage_path": 1})
    if not rec:
        raise HTTPException(status_code=404, detail="Design not found.")
    await db.ai_designs.delete_one({"id": design_id, "household_id": h["id"]})
    if rec.get("storage_path"):
        try:
            await run_in_threadpool(delete_object, rec["storage_path"])
        except Exception:  # noqa: BLE001
            pass  # best-effort; DB record already removed
    return {"deleted": True}
