"""Password reset flow.

  1. `POST /api/auth/forgot-password` — user submits their email; backend
     generates a short-lived JWT, emails it via SendGrid, and ALWAYS returns
     200 (we don't leak which emails are registered).
  2. `POST /api/auth/reset-password` — user submits token + new password.
     Backend verifies token, hashes new password, invalidates outstanding
     tokens by bumping a `password_version` field (future hardening), and
     returns 200.

We rate-limit the request endpoint to 5/minute per IP so it can't be used
as a spam pump against SendGrid.
"""
import logging

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import HTMLResponse

from core.db import db
from core.models import ForgotPasswordPayload, ResetPasswordPayload
from core.security import hash_password, limiter
from core.email import (
    make_password_reset_token, verify_password_reset_token,
    send_email, password_reset_links,
)
from core.email_templates import render_password_reset
from core.config import PASSWORD_RESET_EXPIRE_MINUTES

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


@router.post("/auth/forgot-password")
@limiter.limit("5/minute")
async def forgot_password(request: Request, payload: ForgotPasswordPayload):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0, "id": 1, "email": 1, "name": 1})
    # Always return success so callers can't enumerate registered emails.
    if not user:
        logger.info("forgot-password: no user for %s (returning ok)", email)
        return {"ok": True}
    token = make_password_reset_token(user["id"])
    deep, web = password_reset_links(token)
    subject, html, text = render_password_reset(
        name=user.get("name"),
        deep_link=deep,
        web_link=web,
        ttl_minutes=PASSWORD_RESET_EXPIRE_MINUTES,
    )
    ok = send_email(to=user["email"], subject=subject, html=html, text=text)
    if not ok:
        logger.warning("forgot-password: email send failed for %s", user["email"])
    return {"ok": True}


@router.post("/auth/reset-password")
@limiter.limit("10/minute")
async def reset_password(request: Request, payload: ResetPasswordPayload):
    user_id = verify_password_reset_token(payload.token)
    if not user_id:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired. Request a new one.")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=400, detail="Account not found")
    new_hash = hash_password(payload.new_password)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"password_hash": new_hash}},
    )
    return {"ok": True, "email": user["email"]}


# ---------------------------------------------------------------
# Desktop-friendly HTML reset page (rendered server-side, no app
# required). The email's "web fallback" link points here. The form
# POSTs JSON to /api/auth/reset-password above using same-origin fetch
# so we don't need CORS for it.
# ---------------------------------------------------------------
@router.get("/auth/reset", response_class=HTMLResponse)
async def reset_password_page(token: str = Query(default="")):
    # Pre-validate the token so we can render a nice "expired" page
    # without making the user type a password first.
    valid_user_id = verify_password_reset_token(token) if token else None
    if not token or not valid_user_id:
        return HTMLResponse(_invalid_token_page(), status_code=400)
    return HTMLResponse(_reset_form_page(token))


def _shell(title: str, body_html: str) -> str:
    return (
        '<!doctype html><html><head>'
        '<meta name="viewport" content="width=device-width,initial-scale=1"/>'
        f'<title>{title} \u2014 CheerPlanner</title>'
        '</head><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;'
        'background:#F8FAFC;color:#0F172A;margin:0;padding:48px 16px;min-height:100vh;box-sizing:border-box">'
        '<div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;'
        'border-radius:14px;padding:32px 28px">'
        '<div style="font-weight:800;color:#E11D48;font-size:18px;text-align:center;margin-bottom:14px">CheerPlanner</div>'
        + body_html +
        '</div></body></html>'
    )


def _invalid_token_page() -> str:
    body = (
        '<h1 style="margin:0 0 12px 0;font-size:22px;text-align:center">Link expired</h1>'
        '<p style="color:#475569;text-align:center;line-height:1.55;margin:0">'
        'This password reset link is invalid or has expired. Open the CheerPlanner app and '
        'tap <strong>"Forgot password?"</strong> on the sign-in screen to request a new one.'
        '</p>'
    )
    return _shell("Link expired", body)


def _reset_form_page(token: str) -> str:
    # The form posts JSON directly to /api/auth/reset-password. Same origin,
    # no CORS gymnastics needed.
    body = (
        '<h1 style="margin:0 0 8px 0;font-size:22px;text-align:center">Set a new password</h1>'
        '<p style="color:#475569;text-align:center;font-size:14px;margin:0 0 24px">'
        "Pick a password you'll remember. At least 6 characters."
        '</p>'

        '<label style="font-size:12px;letter-spacing:.5px;color:#475569;text-transform:uppercase">New password</label>'
        '<input id="pw" type="password" autocomplete="new-password" '
        'style="display:block;width:100%;box-sizing:border-box;margin:6px 0 16px;padding:12px 14px;'
        'border:1px solid #E2E8F0;border-radius:10px;font-size:15px"/>'

        '<label style="font-size:12px;letter-spacing:.5px;color:#475569;text-transform:uppercase">Confirm password</label>'
        '<input id="confirm" type="password" autocomplete="new-password" '
        'style="display:block;width:100%;box-sizing:border-box;margin:6px 0 16px;padding:12px 14px;'
        'border:1px solid #E2E8F0;border-radius:10px;font-size:15px"/>'

        '<button id="submit" '
        'style="display:block;width:100%;padding:14px;background:#E11D48;color:#fff;border:0;'
        'border-radius:10px;font-size:15px;font-weight:700;cursor:pointer">Update password</button>'

        '<p id="msg" style="margin-top:16px;text-align:center;font-size:14px;min-height:20px"></p>'

        '<p style="margin-top:24px;text-align:center;font-size:13px;color:#94A3B8">'
        'Already have the app? <a href="cheerplanner://reset?token=' + token + '" '
        'style="color:#E11D48;font-weight:600">Open in CheerPlanner</a>'
        '</p>'

        '<script>'
        f'var TOKEN = {token!r};'
        'var msg = document.getElementById("msg");'
        'var btn = document.getElementById("submit");'
        'btn.addEventListener("click", async function() {'
        '  var pw = document.getElementById("pw").value;'
        '  var c  = document.getElementById("confirm").value;'
        '  msg.style.color = "#B91C1C";'
        '  if (pw.length < 6) { msg.textContent = "Password must be at least 6 characters."; return; }'
        '  if (pw !== c) { msg.textContent = "Passwords don\\u2019t match."; return; }'
        '  btn.disabled = true; btn.textContent = "Updating\\u2026";'
        '  try {'
        '    var r = await fetch("/api/auth/reset-password", {'
        '      method: "POST", headers: {"Content-Type": "application/json"},'
        '      body: JSON.stringify({ token: TOKEN, new_password: pw })'
        '    });'
        '    var data = await r.json().catch(function(){return {};});'
        '    if (r.ok) {'
        '      msg.style.color = "#16A34A";'
        '      msg.textContent = "Password updated! You can now sign in with your new password.";'
        '      btn.style.display = "none";'
        '      document.getElementById("pw").disabled = true;'
        '      document.getElementById("confirm").disabled = true;'
        '    } else {'
        '      msg.textContent = data.detail || "Reset failed. Request a new link.";'
        '      btn.disabled = false; btn.textContent = "Update password";'
        '    }'
        '  } catch (e) {'
        '    msg.textContent = "Network error. Please try again.";'
        '    btn.disabled = false; btn.textContent = "Update password";'
        '  }'
        '});'
        '</script>'
    )
    return _shell("Reset password", body)
