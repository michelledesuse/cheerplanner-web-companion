from datetime import datetime as _dt, timedelta as _td
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core.db import db
from core.models import Household, HouseholdInvite, HouseholdJoinRequest, utcnow_iso, EXPENSE_CATEGORIES
from core.security import get_current_user
from core.helpers import _get_or_create_household, _household_owner_id, _member_visibility, PRIVACY_AREAS
from core.theme_presets import THEME_PRESETS, DEFAULT_THEME

router = APIRouter(prefix="/api")


@router.get("/household")
async def get_household(current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    owner_id = _household_owner_id(h)
    member_privacy = h.get("member_privacy") or {}
    members = []
    async for u in db.users.find({"id": {"$in": h["member_user_ids"]}}, {"_id": 0, "id": 1, "email": 1, "name": 1}):
        priv = member_privacy.get(u["id"]) or {}
        u["is_owner"] = u["id"] == owner_id
        # Owner always sees everything; others default to visible unless hidden.
        u["privacy"] = {
            a: (True if u["id"] == owner_id else bool(priv.get(a, True)))
            for a in PRIVACY_AREAS
        }
        members.append(u)
    return {
        "id": h["id"],
        "members": members,
        "owner_user_id": owner_id,
        "is_owner": current_user["id"] == owner_id,
        "visibility": await _member_visibility(current_user["id"]),
        "theme": h.get("theme") or dict(DEFAULT_THEME),
        "custom_expense_categories": h.get("custom_expense_categories") or [],
        "custom_event_types": h.get("custom_event_types") or [],
    }


@router.patch("/household/privacy/{member_user_id}")
async def update_member_privacy(
    member_user_id: str,
    payload: Dict[str, Any] = Body(...),
    current_user=Depends(get_current_user),
):
    """Owner-only: set which data areas a household member may view.

    Body accepts any of the PRIVACY_AREAS as booleans, e.g.
    `{"expenses": false, "travel": true}`.
    """
    h = await _get_or_create_household(current_user["id"])
    owner_id = _household_owner_id(h)
    if current_user["id"] != owner_id:
        raise HTTPException(status_code=403, detail="Only the household owner can change privacy settings.")
    if member_user_id == owner_id:
        raise HTTPException(status_code=400, detail="The owner always has full access.")
    if member_user_id not in (h.get("member_user_ids") or []):
        raise HTTPException(status_code=404, detail="That member is not in your household.")

    member_privacy = h.get("member_privacy") or {}
    current = dict(member_privacy.get(member_user_id) or {})
    for area in PRIVACY_AREAS:
        if area in payload:
            current[area] = bool(payload[area])
    member_privacy[member_user_id] = current
    await db.households.update_one({"id": h["id"]}, {"$set": {"member_privacy": member_privacy}})
    return {
        "member_user_id": member_user_id,
        "privacy": {a: bool(current.get(a, True)) for a in PRIVACY_AREAS},
    }


# ============================================================
# v2.3 — Household custom types (event types + expense categories)
# ============================================================
@router.get("/household/custom-types")
async def get_custom_types(current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    return {
        "expense_categories": h.get("custom_expense_categories") or [],
        "event_types": h.get("custom_event_types") or [],
    }


@router.post("/household/custom-types/expense-category")
async def add_custom_expense_category(
    payload: Dict[str, Any] = Body(...),
    current_user=Depends(get_current_user),
):
    name = (payload.get("name") or "").strip()[:40]
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    h = await _get_or_create_household(current_user["id"])
    existing = h.get("custom_expense_categories") or []
    taken = {c.lower() for c in EXPENSE_CATEGORIES} | {c.lower() for c in existing}
    if name.lower() in taken:
        raise HTTPException(status_code=400, detail="That category already exists")
    existing = (existing + [name])[-50:]
    await db.households.update_one({"id": h["id"]}, {"$set": {"custom_expense_categories": existing}})
    return {"expense_categories": existing}


@router.delete("/household/custom-types/expense-category")
async def delete_custom_expense_category(
    payload: Dict[str, Any] = Body(...),
    current_user=Depends(get_current_user),
):
    name = (payload.get("name") or "").strip()
    h = await _get_or_create_household(current_user["id"])
    existing = [c for c in (h.get("custom_expense_categories") or []) if c.lower() != name.lower()]
    await db.households.update_one({"id": h["id"]}, {"$set": {"custom_expense_categories": existing}})
    return {"expense_categories": existing}


@router.post("/household/custom-types/event-type")
async def add_custom_event_type(
    payload: Dict[str, Any] = Body(...),
    current_user=Depends(get_current_user),
):
    import re as _re, secrets as _secrets
    label = (payload.get("label") or "").strip()[:30]
    color = (payload.get("color") or "#64748B").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Event type name is required")
    h = await _get_or_create_household(current_user["id"])
    existing = h.get("custom_event_types") or []
    slug = _re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "type"
    entry = {"id": f"custom_{slug}_{_secrets.token_hex(2)}", "label": label, "color": color}
    existing = (existing + [entry])[-50:]
    await db.households.update_one({"id": h["id"]}, {"$set": {"custom_event_types": existing}})
    return {"event_types": existing, "event_type": entry}


@router.delete("/household/custom-types/event-type/{type_id}")
async def delete_custom_event_type(type_id: str, current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    existing = [t for t in (h.get("custom_event_types") or []) if t.get("id") != type_id]
    await db.households.update_one({"id": h["id"]}, {"$set": {"custom_event_types": existing}})
    return {"event_types": existing}


# ============================================================
# v1.0.8 \u2014 Theme presets + per-household theme
# ============================================================
@router.get("/themes/presets")
async def list_theme_presets(current_user=Depends(get_current_user)):
    """Static list of preset themes the client renders in the picker grid."""
    return {"presets": THEME_PRESETS}


@router.patch("/household/theme")
async def update_household_theme(
    payload: Dict[str, Any] = Body(...),
    current_user=Depends(get_current_user),
):
    """Save the household's active theme choice.

    Accepts either:
      - `{ "preset_id": "patriotic" }`  (a built-in preset id OR a saved custom preset id)
      - `{ "preset_id": "custom", "custom": { accent, accentSubtle, bg, card, textPrimary, tabActive } }`
    The household's list of saved custom presets (`theme.saved`) is preserved.
    """
    h = await _get_or_create_household(current_user["id"])
    existing = h.get("theme") or dict(DEFAULT_THEME)
    saved = existing.get("saved") or []
    preset_id = payload.get("preset_id") or "classic_red"
    custom = payload.get("custom") if preset_id == "custom" else None
    if preset_id != "custom":
        valid_ids = {p["id"] for p in THEME_PRESETS} | {s.get("id") for s in saved}
        if preset_id not in valid_ids:
            raise HTTPException(status_code=400, detail=f"Unknown preset_id '{preset_id}'")
    elif not custom or not isinstance(custom, dict):
        raise HTTPException(status_code=400, detail="`custom` palette required when preset_id='custom'")

    theme = {"preset_id": preset_id, "custom": custom, "saved": saved}
    await db.households.update_one({"id": h["id"]}, {"$set": {"theme": theme}})
    return {"theme": theme}


_PALETTE_KEYS = ("accent", "accentSubtle", "bg", "card", "textPrimary", "tabActive")


@router.post("/household/theme/saved")
async def save_custom_theme(
    payload: Dict[str, Any] = Body(...),
    current_user=Depends(get_current_user),
):
    """Save the current custom palette as a named preset and make it active.

    Body: `{ name, accent, accentSubtle, bg, card, textPrimary, tabActive }`
    """
    import re as _re, secrets as _secrets

    name = (payload.get("name") or "").strip() or "My theme"
    palette = {k: payload.get(k) for k in _PALETTE_KEYS if payload.get(k)}
    if "accent" not in palette or "bg" not in palette:
        raise HTTPException(status_code=400, detail="accent and bg are required")
    palette.setdefault("tabActive", palette["accent"])
    palette.setdefault("accentSubtle", palette["accent"] + "22")

    h = await _get_or_create_household(current_user["id"])
    existing = h.get("theme") or dict(DEFAULT_THEME)
    saved = existing.get("saved") or []
    slug = _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "theme"
    new_id = f"saved_{slug}_{_secrets.token_hex(2)}"
    entry = {"id": new_id, "name": name[:40], **palette}
    saved = (saved + [entry])[-20:]  # cap at 20 saved presets

    theme = {"preset_id": new_id, "custom": None, "saved": saved}
    await db.households.update_one({"id": h["id"]}, {"$set": {"theme": theme}})
    return {"theme": theme, "preset": entry}


@router.delete("/household/theme/saved/{saved_id}")
async def delete_custom_theme(saved_id: str, current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    existing = h.get("theme") or dict(DEFAULT_THEME)
    saved = [s for s in (existing.get("saved") or []) if s.get("id") != saved_id]
    preset_id = existing.get("preset_id")
    # If we deleted the active preset, fall back to the default.
    if preset_id == saved_id:
        preset_id = DEFAULT_THEME.get("preset_id", "red_white")
    theme = {"preset_id": preset_id, "custom": existing.get("custom"), "saved": saved}
    await db.households.update_one({"id": h["id"]}, {"$set": {"theme": theme}})
    return {"theme": theme}


@router.post("/household/invite")
async def create_household_invite(current_user=Depends(get_current_user)):
    import secrets
    h = await _get_or_create_household(current_user["id"])
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no confusing 0/O/1/I
    code = "".join(secrets.choice(alphabet) for _ in range(6))
    expires = (_dt.utcnow() + _td(days=7)).isoformat() + "Z"
    invite = HouseholdInvite(
        household_id=h["id"],
        invited_by=current_user["id"],
        code=code,
        expires_at=expires,
    ).model_dump()
    await db.household_invites.insert_one(invite)
    return {"code": code, "expires_at": expires}


@router.post("/household/join")
async def join_household(payload: HouseholdJoinRequest, current_user=Depends(get_current_user)):
    code = payload.code.strip().upper()
    invite = await db.household_invites.find_one({"code": code, "used_at": None}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid or expired invite code")
    try:
        expires = _dt.fromisoformat(invite["expires_at"].replace("Z", ""))
        if expires < _dt.utcnow():
            raise HTTPException(status_code=400, detail="Invite code has expired")
    except (ValueError, KeyError):
        pass
    user_id = current_user["id"]
    if user_id == invite["invited_by"]:
        raise HTTPException(status_code=400, detail="You can't use your own invite code")

    # Team Hub delegation invite: join as a COLLABORATOR, not a household member.
    # This keeps Team Hub collaborators off the household seat count and out of
    # the family's personal data. (requirement #4)
    if invite.get("grant_team_access"):
        await db.households.update_one(
            {"id": invite["household_id"]},
            {"$addToSet": {"team_hub_member_user_ids": user_id}},
        )
        await db.users.update_one({"id": user_id}, {"$set": {"team_access": True}})
        await db.household_invites.update_one(
            {"id": invite["id"]}, {"$set": {"used_at": utcnow_iso()}}
        )
        return {"joined": True, "household_id": invite["household_id"], "team_access": True, "collaborator": True}

    # Regular household join (co-parent): becomes a full household member.
    # Remove user from current household (and delete household if empty)
    current_h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    if current_h and current_h["id"] != invite["household_id"]:
        new_members = [u for u in current_h["member_user_ids"] if u != user_id]
        if new_members:
            await db.households.update_one({"id": current_h["id"]}, {"$set": {"member_user_ids": new_members}})
        else:
            await db.households.delete_one({"id": current_h["id"]})
    # Add user to target household
    await db.households.update_one(
        {"id": invite["household_id"]},
        {"$addToSet": {"member_user_ids": user_id}},
    )
    # Mark invite as used
    await db.household_invites.update_one(
        {"id": invite["id"]}, {"$set": {"used_at": utcnow_iso()}}
    )
    return {"joined": True, "household_id": invite["household_id"], "team_access": False}


@router.post("/household/leave")
async def leave_household(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="No household")
    remaining = [u for u in h["member_user_ids"] if u != user_id]
    if remaining:
        await db.households.update_one({"id": h["id"]}, {"$set": {"member_user_ids": remaining}})
    else:
        await db.households.delete_one({"id": h["id"]})
    new_h = Household(member_user_ids=[user_id]).model_dump()
    await db.households.insert_one(new_h)
    return {"left": True, "new_household_id": new_h["id"]}
