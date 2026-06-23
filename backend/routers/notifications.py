"""Notification preferences + unsubscribe deep link.

Every user has a `notification_preferences` field on their user doc. Defaults
are applied lazily on first GET so legacy accounts work without a migration.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse

from core.db import db
from core.models import NotificationPreferences, NotificationPreferencesUpdate
from core.security import get_current_user
from core.email import verify_unsubscribe_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


DEFAULT_PREFS = NotificationPreferences().model_dump()


@router.get("/notifications/preferences", response_model=NotificationPreferences)
async def get_preferences(current_user=Depends(get_current_user)):
    user_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "notification_preferences": 1})
    prefs = (user_doc or {}).get("notification_preferences") or {}
    # Deep-merge defaults so newly-added categories light up automatically.
    merged = {**DEFAULT_PREFS, **prefs}
    merged["categories"] = {**DEFAULT_PREFS["categories"], **(prefs.get("categories") or {})}
    return NotificationPreferences(**merged)


@router.patch("/notifications/preferences", response_model=NotificationPreferences)
async def update_preferences(payload: NotificationPreferencesUpdate, current_user=Depends(get_current_user)):
    user_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "notification_preferences": 1})
    existing = (user_doc or {}).get("notification_preferences") or {}
    merged = {**DEFAULT_PREFS, **existing}
    merged["categories"] = {**DEFAULT_PREFS["categories"], **(existing.get("categories") or {})}

    sent = payload.model_dump(exclude_unset=True)
    if "enabled" in sent:
        merged["enabled"] = bool(sent["enabled"])
    if "frequency" in sent and sent["frequency"] in ("daily", "weekly", "off"):
        merged["frequency"] = sent["frequency"]
        # Convenience: frequency=off also flips the master switch.
        if sent["frequency"] == "off":
            merged["enabled"] = False
        else:
            # User explicitly chose a sending frequency — implicitly re-enable.
            merged["enabled"] = sent.get("enabled", merged["enabled"]) if "enabled" in sent else True
    if "categories" in sent and sent["categories"]:
        merged["categories"] = {**merged["categories"], **dict(sent["categories"])}
    if "timezone" in sent and sent["timezone"]:
        merged["timezone"] = sent["timezone"]

    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"notification_preferences": merged}},
    )
    return NotificationPreferences(**merged)


# ---------------------------------------------------------------
# Unsubscribe (no auth — token is a signed JWT)
# ---------------------------------------------------------------
@router.get("/notifications/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str = Query(...)):
    user_id = verify_unsubscribe_token(token)
    if not user_id:
        return HTMLResponse(
            _page("Link expired", "This unsubscribe link is invalid or has expired. "
                  "Open CheerPlanner and go to Settings \u2192 Notifications to manage your preferences."),
            status_code=400,
        )
    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "notification_preferences": 1})
    if not user_doc:
        return HTMLResponse(_page("Account not found", "We couldn't find your account."), status_code=404)

    existing = user_doc.get("notification_preferences") or {}
    merged = {**DEFAULT_PREFS, **existing}
    merged["enabled"] = False
    merged["frequency"] = "off"
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"notification_preferences": merged}},
    )
    return HTMLResponse(_page(
        "You're unsubscribed",
        "You will no longer receive reminder emails from CheerPlanner. "
        "You can re-enable them anytime from Settings \u2192 Notifications inside the app.",
    ))


def _page(title: str, body: str) -> str:
    return (
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>'
        f'<title>{title} \u2014 CheerPlanner</title></head>'
        '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;'
        'background:#F8FAFC;color:#0F172A;margin:0;padding:48px 16px;">'
        '<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;'
        'border-radius:14px;padding:32px 28px;text-align:center">'
        '<div style="font-weight:800;color:#E11D48;font-size:18px;margin-bottom:14px">CheerPlanner</div>'
        f'<h1 style="margin:0 0 12px 0;font-size:22px">{title}</h1>'
        f'<p style="color:#475569;font-size:15px;line-height:1.55;margin:0">{body}</p>'
        '</div></body></html>'
    )
