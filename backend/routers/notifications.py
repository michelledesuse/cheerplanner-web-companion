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
from core.sms import send_sms, normalize_us_phone, is_configured

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
    if "sms_enabled" in sent:
        merged["sms_enabled"] = bool(sent["sms_enabled"])
    if "sms_phone" in sent:
        merged["sms_phone"] = sent["sms_phone"]
    if "sms_consent_at" in sent:
        merged["sms_consent_at"] = sent["sms_consent_at"]

    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"notification_preferences": merged}},
    )
    return NotificationPreferences(**merged)


@router.post("/notifications/sms-test")
async def send_test_sms(current_user=Depends(get_current_user)):
    """Send a one-off test SMS to the user's saved mobile number to confirm
    Twilio delivery. Requires the user to have opted in (sms_enabled) with a
    saved sms_phone."""
    if not is_configured():
        raise HTTPException(status_code=503, detail="SMS is not configured on the server.")
    user_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "notification_preferences": 1})
    prefs = (user_doc or {}).get("notification_preferences") or {}
    if not prefs.get("sms_enabled"):
        raise HTTPException(status_code=400, detail="Turn on SMS reminders first.")
    phone = prefs.get("sms_phone")
    if not normalize_us_phone(phone):
        raise HTTPException(status_code=400, detail="Add a valid US mobile number first.")
    ok = send_sms(phone, "CheerPlanner: your SMS reminders are set up correctly. Reply STOP to opt out.")
    if not ok:
        raise HTTPException(status_code=502, detail="Couldn't send the test text. Please try again shortly.")
    return {"sent": True}


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


CONSENT_DISCLOSURE = (
    "By opting in, you agree to receive recurring automated reminder text messages from "
    "CheerPlanner at the mobile number provided (e.g. payment due dates, competitions, and "
    "travel deadlines). Consent is not a condition of purchase. Message frequency varies. "
    "Message and data rates may apply. Reply STOP to unsubscribe or HELP for help."
)


@router.get("/notifications/opt-in", response_class=HTMLResponse)
async def opt_in_proof():
    """Public, no-auth page documenting the CheerPlanner SMS opt-in flow.

    Submit this page's URL to Twilio toll-free verification as the opt-in
    proof / web form when image uploads are not accepted.
    """
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8"/>'
        '<meta name="viewport" content="width=device-width,initial-scale=1"/>'
        '<title>SMS Opt-In — CheerPlanner</title></head>'
        '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;'
        'background:#F8FAFC;color:#0F172A;margin:0;padding:40px 16px;">'
        '<div style="max-width:560px;margin:0 auto;">'
        '<div style="font-weight:800;font-size:20px;margin-bottom:6px"><span style="color:#4169E1">Cheer</span><span style="color:#000000">Planner</span></div>'
        '<h1 style="margin:0 0 6px 0;font-size:24px">SMS Reminder Opt-In</h1>'
        '<p style="color:#475569;font-size:14px;margin:0 0 24px 0">How consumers consent to receive text messages from CheerPlanner.</p>'

        '<h2 style="font-size:16px;margin:24px 0 8px">How opt-in is collected</h2>'
        '<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px">'
        'CheerPlanner is a mobile app for cheer parents. After signing in, a user goes to '
        '<b>Settings &rarr; Notifications</b>, enters their mobile number, and turns the '
        '<b>&ldquo;Send me SMS reminders&rdquo;</b> toggle ON. The toggle is OFF by default; the user must '
        'actively enable it. When enabled, the app records the consent timestamp and mobile number on '
        'the user&rsquo;s account. No messages are sent unless the user opts in. Consent is not a '
        'condition of using the app.</p>'

        # Visual reproduction of the in-app opt-in screen
        '<h2 style="font-size:16px;margin:24px 0 8px">The opt-in screen (in-app)</h2>'
        '<div style="max-width:340px;margin:0 auto 16px;border:1px solid #E2E8F0;border-radius:16px;'
        'overflow:hidden;background:#fff">'
        '<div style="background:#0F172A;color:#fff;text-align:center;padding:12px;font-weight:700">Notifications</div>'
        '<div style="padding:16px">'
        '<div style="text-transform:uppercase;letter-spacing:.5px;color:#94A3B8;font-size:11px;margin-bottom:8px">Text message (SMS) reminders</div>'
        '<div style="border:1px solid #E2E8F0;border-radius:12px;padding:12px;margin-bottom:12px">'
        '<div style="color:#475569;font-size:13px;margin-bottom:12px">Get a text when a payment, competition, or travel deadline is coming up.</div>'
        '<div style="text-transform:uppercase;letter-spacing:.5px;color:#94A3B8;font-size:10px;margin-bottom:4px">Mobile number</div>'
        '<div style="border:1px solid #E2E8F0;border-radius:8px;padding:10px;color:#0F172A;font-size:14px;margin-bottom:14px">(555) 123-4567</div>'
        '<div style="display:flex;align-items:center;justify-content:space-between">'
        '<div><div style="font-weight:600;color:#0F172A;font-size:14px">Send me SMS reminders</div>'
        '<div style="color:#64748B;font-size:12px">You must opt in to receive texts.</div></div>'
        '<div style="width:44px;height:26px;border-radius:13px;background:#CBD5E1;position:relative;flex:none">'
        '<div style="position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:10px;background:#fff"></div></div>'
        '</div></div>'
        f'<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px;color:#475569;font-size:12px;line-height:1.55">{CONSENT_DISCLOSURE}</div>'
        '</div></div>'

        '<h2 style="font-size:16px;margin:24px 0 8px">Exact consent language shown to the user</h2>'
        f'<blockquote style="margin:0;border-left:4px solid #E11D48;background:#fff;border:1px solid #E2E8F0;'
        f'border-radius:8px;padding:14px 16px;color:#334155;font-size:14px;line-height:1.6">{CONSENT_DISCLOSURE}</blockquote>'

        '<h2 style="font-size:16px;margin:24px 0 8px">Message types &amp; frequency</h2>'
        '<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 8px">'
        'Account reminders only: payment due dates, upcoming competitions, and travel/booking deadlines. '
        'Frequency varies with the user&rsquo;s own schedule (typically a few messages per month). '
        'Message and data rates may apply.</p>'
        '<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 8px"><b>Sample message:</b> '
        '&ldquo;CheerPlanner: Tuition of $150 for Emma is due tomorrow (Jul 4). Reply STOP to opt out.&rdquo;</p>'

        '<h2 style="font-size:16px;margin:24px 0 8px">Opt-out</h2>'
        '<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 8px">'
        'Users can reply STOP at any time, or turn the toggle OFF in Settings &rarr; Notifications. '
        'Reply HELP for help.</p>'

        '<p style="color:#334155;font-size:15px;line-height:1.6;margin:24px 0 8px">'
        'Privacy Policy: <a href="https://cheer-planner.com/privacy" style="color:#E11D48">cheer-planner.com/privacy</a>. '
        'Mobile opt-in data and phone numbers are never sold or shared with third parties for marketing.</p>'

        '<p style="color:#94A3B8;font-size:12px;margin-top:24px">CheerPlanner &middot; info@cheer-planner.com</p>'
        '</div></body></html>'
    )
