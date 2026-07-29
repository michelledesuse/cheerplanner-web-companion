"""Twilio SMS sending helper (v2.4).

Sends outbound reminder texts from the household's toll-free number. Designed to
be called from the scheduler: it never raises and returns True/False so a send
failure can't crash the digest job. If Twilio isn't configured, send_sms is a
no-op that returns False.

Toll-free STOP/HELP opt-out is handled automatically by Twilio at the carrier
level for verified US toll-free numbers — messages to opted-out numbers are
blocked by Twilio, so we don't need our own STOP webhook for compliance.
"""
import logging
import os
import re
from typing import Optional

logger = logging.getLogger("core.sms")

_client = None
_client_init = False


def _get_client():
    global _client, _client_init
    if _client_init:
        return _client
    _client_init = True
    sid = os.getenv("TWILIO_ACCOUNT_SID")
    token = os.getenv("TWILIO_AUTH_TOKEN")
    if not sid or not token:
        logger.info("Twilio not configured — SMS disabled")
        _client = None
        return None
    try:
        from twilio.rest import Client
        _client = Client(sid, token)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Twilio client init failed: %s", exc)
        _client = None
    return _client


def is_configured() -> bool:
    return bool(
        os.getenv("TWILIO_ACCOUNT_SID")
        and os.getenv("TWILIO_AUTH_TOKEN")
        and os.getenv("TWILIO_PHONE_NUMBER")
    )


def normalize_us_phone(raw: Optional[str]) -> Optional[str]:
    """Return an E.164 number (+1XXXXXXXXXX for US) or None if unparseable."""
    if not raw:
        return None
    s = str(raw).strip()
    if s.startswith("+"):
        digits = re.sub(r"\D", "", s)
        return "+" + digits if len(digits) >= 11 else None
    digits = re.sub(r"\D", "", s)
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def send_sms(to: str, body: str) -> bool:
    """Send an SMS via Twilio. Returns True on success, False otherwise. Never raises."""
    client = _get_client()
    from_number = os.getenv("TWILIO_PHONE_NUMBER")
    if not client or not from_number:
        return False
    dest = normalize_us_phone(to)
    if not dest:
        logger.warning("send_sms: invalid destination number")
        return False
    try:
        msg = client.messages.create(to=dest, from_=from_number, body=body)
        logger.info("SMS sent sid=%s to=%s", getattr(msg, "sid", "?"), dest)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("send_sms failed: %s", exc)
        return False


def join_links(links) -> str:
    """Format a list of links (ExternalLink dicts {label,url} or plain strings)
    into a single space-separated string suitable for an SMS body, e.g.
    'Waiver: https://... Medical: https://...'."""
    parts = []
    for l in links or []:
        if isinstance(l, dict):
            url = (l.get("url") or "").strip()
            label = (l.get("label") or "").strip()
        else:
            url = str(l or "").strip()
            label = ""
        if not url:
            continue
        parts.append(f"{label}: {url}" if label else url)
    return " ".join(parts)
