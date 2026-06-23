"""SendGrid email service.

Thin wrapper around the official `sendgrid` SDK that:
  * Loads the API key + sender identity from env (`core/config.py`)
  * Sends multipart (HTML + plaintext) transactional emails
  * Logs delivery errors rather than raising — a failed send must NEVER crash
    the APScheduler tick or the request handler that triggered it.

Public helpers:
  * `send_email(to, subject, html, text)` -> bool
  * `make_password_reset_token(user_id)` -> str  (short-lived JWT)
  * `verify_password_reset_token(token)` -> str (user_id) | None
  * `make_unsubscribe_token(user_id)` -> str
  * `verify_unsubscribe_token(token)` -> str (user_id) | None
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

import jwt
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Email, To, Content

from core.config import (
    SENDGRID_API_KEY, SENDER_EMAIL, SENDER_NAME,
    JWT_SECRET, JWT_ALGORITHM,
    PASSWORD_RESET_EXPIRE_MINUTES, UNSUBSCRIBE_EXPIRE_DAYS,
    APP_URL_SCHEME, WEB_FALLBACK_URL,
)

logger = logging.getLogger(__name__)


# ============================================================
# Send
# ============================================================
def send_email(
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
) -> bool:
    """Send a transactional email via SendGrid.

    Returns True on a SendGrid-accepted (2xx) response, False otherwise.
    Never raises — caller can rely on a boolean.
    """
    if not SENDGRID_API_KEY:
        logger.warning("SENDGRID_API_KEY missing; skipping send to %s", to)
        return False
    try:
        from_email = Email(SENDER_EMAIL, SENDER_NAME)
        msg = Mail(
            from_email=from_email,
            to_emails=To(to),
            subject=subject,
            html_content=html,
            plain_text_content=text or _html_to_plaintext(html),
        )
        client = SendGridAPIClient(SENDGRID_API_KEY)
        resp = client.send(msg)
        ok = 200 <= resp.status_code < 300
        if not ok:
            logger.warning(
                "SendGrid non-2xx %s sending to %s: %s",
                resp.status_code, to, getattr(resp, "body", b"")[:200],
            )
        return ok
    except Exception as exc:  # noqa: BLE001 - we intentionally swallow
        logger.exception("Email send failed to %s: %s", to, exc)
        return False


def _html_to_plaintext(html: str) -> str:
    """Very rough HTML → plaintext fallback (no external dep)."""
    import re
    txt = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    txt = re.sub(r"</p>", "\n\n", txt, flags=re.I)
    txt = re.sub(r"<[^>]+>", "", txt)
    # collapse repeated whitespace lines
    lines = [ln.strip() for ln in txt.splitlines()]
    return "\n".join([ln for ln in lines if ln])


# ============================================================
# JWT tokens (signed, short-lived)
# ============================================================
_PASSWORD_RESET_ISS = "cheerplanner:password-reset"
_UNSUBSCRIBE_ISS = "cheerplanner:unsubscribe"


def make_password_reset_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iss": _PASSWORD_RESET_ISS,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_RESET_EXPIRE_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_password_reset_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None
    if payload.get("iss") != _PASSWORD_RESET_ISS:
        return None
    return payload.get("sub")


def make_unsubscribe_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iss": _UNSUBSCRIBE_ISS,
        "exp": datetime.now(timezone.utc) + timedelta(days=UNSUBSCRIBE_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_unsubscribe_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None
    if payload.get("iss") != _UNSUBSCRIBE_ISS:
        return None
    return payload.get("sub")


# ============================================================
# Deep-link helpers
# ============================================================
def password_reset_links(token: str) -> Tuple[str, str]:
    """Return (deep_link, web_fallback) URLs for a password reset."""
    deep = f"{APP_URL_SCHEME}://reset?token={token}"
    web = f"{WEB_FALLBACK_URL}/reset?token={token}"
    return deep, web


def unsubscribe_link(token: str) -> str:
    """Backend-hosted unsubscribe URL (no app needed)."""
    return f"{WEB_FALLBACK_URL}/api/notifications/unsubscribe?token={token}"
