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
from core.gating import assert_premium
from core.storage import put_object, delete_object, APP_NAME
from routers.team_chat import _chat_hub, _display_name

router = APIRouter(prefix="/api")

IMAGE_MODEL = os.environ.get("AI_DESIGNER_MODEL", "gpt-image-2")
ALLOWED_SIZES = {"1024x1024", "1536x1024", "1024x1536", "auto"}
MAX_VARIATIONS = 4
MAX_INPUT_IMAGES = 4
FEATURE = "ai_designer"


def _client():
    from openai import OpenAI
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def _openai_one(prompt: str, size: str, transparent: bool, input_images: list) -> bytes:
    """Generate ONE image. If input_images are provided use the edit endpoint
    (reference images / logo / a design being tweaked); otherwise generate from
    text. Returns raw PNG bytes."""
    client = _client()
    kwargs = {"model": IMAGE_MODEL, "prompt": prompt, "size": size, "n": 1}
    if transparent:
        kwargs["background"] = "transparent"
    if input_images:
        files = []
        for i, raw in enumerate(input_images):
            f = io.BytesIO(raw)
            f.name = f"input_{i}.png"
            files.append(f)
        resp = client.images.edit(image=files, **kwargs)
    else:
        resp = client.images.generate(**kwargs)
    b64 = resp.data[0].b64_json
    if not b64:
        raise RuntimeError("No image returned.")
    return base64.b64decode(b64)


def _decode_inputs(payload: dict) -> list:
    """Collect reference image(s), a logo, and/or a design-to-edit into a single
    ordered list of raw image bytes for the edit endpoint."""
    raws = []
    edit_img = payload.get("edit_image")
    if edit_img:
        raws.append(edit_img)
    for ref in (payload.get("reference_images") or []):
        raws.append(ref)
    if payload.get("logo"):
        raws.append(payload.get("logo"))
    out = []
    for b in raws[:MAX_INPUT_IMAGES]:
        s = b.split(",", 1)[1] if isinstance(b, str) and b.startswith("data:") else b
        try:
            out.append(base64.b64decode(s))
        except Exception:  # noqa: BLE001
            continue
    return out


def _thumb(data: bytes, box: int = 400) -> str:
    """Small data-URL thumbnail for the designs gallery."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((box, box))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("utf-8")


@router.post("/ai-designer/generate")
async def generate_design(payload: dict = Body(...), user=Depends(require_team_access)):
    import asyncio
    await assert_premium(user["id"], FEATURE)
    prompt = (payload.get("prompt") or "").strip()
    # Apply a saved brand preset (logo + colors) if one is selected.
    brand_id = payload.get("brand_id")
    if brand_id:
        h0 = await _resolve_active_household(user["id"])
        preset = await db.brand_presets.find_one({"id": brand_id, "household_id": (h0 or {}).get("id")}, {"_id": 0}) if h0 else None
        if preset:
            colors = ", ".join(preset.get("colors") or [])
            bits = []
            if preset.get("name"):
                bits.append(f"team {preset['name']}")
            if colors:
                bits.append(f"brand colors {colors}")
            if bits:
                prompt = (prompt + f" Use the {' and '.join(bits)}.").strip()
            if preset.get("logo") and not payload.get("logo"):
                payload = {**payload, "logo": preset["logo"]}
    input_images = _decode_inputs(payload)
    if not prompt and not input_images:
        raise HTTPException(status_code=400, detail="Describe what you'd like to create.")
    if not prompt:
        prompt = "Redesign this into a polished, professional graphic."
    if len(prompt) > 4000:
        prompt = prompt[:4000]
    assert_clean(prompt)
    size = payload.get("size") if payload.get("size") in ALLOWED_SIZES else "1024x1024"
    transparent = bool(payload.get("transparent"))
    try:
        variations = int(payload.get("variations") or 1)
    except (TypeError, ValueError):
        variations = 1
    variations = max(1, min(MAX_VARIATIONS, variations))
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="AI Designer isn't configured yet. Add your OpenAI API key.")
    try:
        # Run the variations in parallel so the request stays fast.
        results = await asyncio.gather(*[
            run_in_threadpool(_openai_one, prompt, size, transparent, input_images)
            for _ in range(variations)
        ])
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
    images = [base64.b64encode(d).decode("utf-8") for d in results]
    return {"images": images, "image_base64": images[0], "prompt": prompt, "size": size}


@router.post("/ai-designer/save")
async def save_design(payload: dict = Body(...), user=Depends(require_team_access)):
    """Save a generated design to the in-app designs library."""
    await assert_premium(user["id"], FEATURE)
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


# ---------------------------------------------------------------
# Post a design straight into Team Chat (coaches/staff can later
# delete it from chat via the normal long-press delete).
# ---------------------------------------------------------------
@router.post("/ai-designer/post-to-chat")
async def post_design_to_chat(payload: dict = Body(...), user=Depends(require_team_access)):
    await assert_premium(user["id"], FEATURE)
    b64 = payload.get("image_base64") or ""
    if not b64:
        raise HTTPException(status_code=400, detail="Nothing to post.")
    try:
        data = base64.b64decode(b64)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid image data.")
    h = await _chat_hub(user["id"], user) or await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=403, detail="No team chat available.")
    media_id = secrets.token_urlsafe(10)
    path = f"{APP_NAME}/ai_designer/{h['id']}/{user['id']}/{uuid.uuid4()}.png"
    try:
        await run_in_threadpool(put_object, path, data, "image/png")
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Couldn't post the design. Please try again.")
    await db.chat_media.insert_one({
        "id": media_id, "household_id": h["id"], "owner_id": user["id"],
        "storage_path": path, "content_type": "image/png", "kind": "image",
        "name": "design.png", "size": len(data), "created_at": utcnow_iso(),
    })
    caption = (payload.get("caption") or "").strip()[:2000]
    if caption:
        assert_clean(caption)
    now = utcnow_iso()
    doc = {
        "id": secrets.token_urlsafe(9), "household_id": h["id"],
        "sender_id": user["id"], "sender_name": _display_name(user),
        "text": caption, "media": [{"id": media_id, "kind": "image", "content_type": "image/png", "name": "design.png"}],
        "reactions": {}, "mentions": [], "created_at": now,
    }
    await db.team_messages.insert_one(dict(doc))
    await db.chat_reads.update_one(
        {"household_id": h["id"], "user_id": user["id"]}, {"$set": {"last_read_at": now}}, upsert=True,
    )
    return {"ok": True, "message_id": doc["id"]}


# ---------------------------------------------------------------
# Brand presets — save multiple brands (name, colors, logo),
# update and delete them. Applied at generate time via brand_id.
# ---------------------------------------------------------------
def _brand_logo(logo_b64: str) -> str:
    """Downscale an uploaded brand logo to a small data URL for storage/reuse."""
    if not logo_b64:
        return ""
    s = logo_b64.split(",", 1)[1] if logo_b64.startswith("data:") else logo_b64
    try:
        img = Image.open(io.BytesIO(base64.b64decode(s)))
        img.thumbnail((512, 512))
        out = io.BytesIO()
        img.save(out, format="PNG")
        return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("utf-8")
    except Exception:  # noqa: BLE001
        return logo_b64


def _clean_brand(payload: dict) -> dict:
    name = (payload.get("name") or "").strip()[:80]
    colors = [str(c).strip()[:24] for c in (payload.get("colors") or []) if str(c).strip()][:5]
    return {"name": name, "colors": colors}


@router.get("/ai-designer/brands")
async def list_brands(user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        return {"brands": []}
    rows = await db.brand_presets.find(
        {"household_id": h["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"brands": rows}


@router.post("/ai-designer/brands")
async def create_brand(payload: dict = Body(...), user=Depends(require_team_access)):
    await assert_premium(user["id"], FEATURE)
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=400, detail="No team hub found.")
    fields = _clean_brand(payload)
    if not fields["name"]:
        raise HTTPException(status_code=400, detail="Give the brand a name.")
    doc = {
        "id": secrets.token_urlsafe(9), "household_id": h["id"], "owner_id": user["id"],
        "name": fields["name"], "colors": fields["colors"],
        "logo": _brand_logo(payload.get("logo") or ""),
        "created_at": utcnow_iso(), "updated_at": utcnow_iso(),
    }
    await db.brand_presets.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.patch("/ai-designer/brands/{brand_id}")
async def update_brand(brand_id: str, payload: dict = Body(...), user=Depends(require_team_access)):
    await assert_premium(user["id"], FEATURE)
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=404, detail="No team hub found.")
    rec = await db.brand_presets.find_one({"id": brand_id, "household_id": h["id"]}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Brand not found.")
    fields = _clean_brand(payload)
    update = {"updated_at": utcnow_iso()}
    if fields["name"]:
        update["name"] = fields["name"]
    if "colors" in payload:
        update["colors"] = fields["colors"]
    if "logo" in payload:
        update["logo"] = _brand_logo(payload.get("logo") or "")
    await db.brand_presets.update_one({"id": brand_id, "household_id": h["id"]}, {"$set": update})
    out = await db.brand_presets.find_one({"id": brand_id, "household_id": h["id"]}, {"_id": 0})
    return out


@router.delete("/ai-designer/brands/{brand_id}")
async def delete_brand(brand_id: str, user=Depends(require_team_access)):
    h = await _resolve_active_household(user["id"])
    if not h:
        raise HTTPException(status_code=404, detail="No team hub found.")
    res = await db.brand_presets.delete_one({"id": brand_id, "household_id": h["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Brand not found.")
    return {"deleted": True}
