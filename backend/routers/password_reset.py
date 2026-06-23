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

from fastapi import APIRouter, HTTPException, Request

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
