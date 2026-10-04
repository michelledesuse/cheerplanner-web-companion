"""Twilio SMS sending helper (v2.4).

Sends outbound reminder texts from the household's toll-free number. Designed to
be called from the scheduler: it never raises and returns True/False so a send
failure can't crash the digest job. If Twilio isn't configured, send_sms is a
no-op that returns False.

Toll-free STOP/HELP opt-out is handled automatically by Twilio at the carrier
level for verified US toll-free numbers — messages to opted-out numbers are
blocked by Twilio, so we don't need our own STOP webhook for compliance.
"""
import asyncio
import logging
import os
import random
import re
import time
from typing import Optional

logger = logging.getLogger("core.sms")

# How many Twilio sends run at once. The Twilio SDK is synchronous/blocking, so
# bulk reminders are dispatched via a threadpool with this cap to keep the async
# event loop responsive and finish fast (avoids request timeouts / Cloudflare 520).
# Kept modest so a burst doesn't trip a toll-free number's per-second throughput
# limit (which shows up as transient 429s / spurious "failed" recipients).
_SEND_CONCURRENCY = 5

# A single send is retried a couple of times on TRANSIENT Twilio errors (rate
# limits, 5xx, network blips) before being reported as failed — this is what
# fixes the "1 of 2 failed, but resending the same number works" glitch.
_MAX_SEND_ATTEMPTS = 3

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
        from twilio.http.http_client import TwilioHttpClient
        # Bound each Twilio HTTP call so a hung request can't stall a worker
        # thread (and block the whole broadcast) indefinitely.
        http = TwilioHttpClient(timeout=20)
        _client = Client(sid, token, http_client=http)
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
    return send_sms_ex(to, body) is not None


def _is_retryable(exc) -> bool:
    """Whether a Twilio send error is worth retrying. Transient failures (rate
    limits, 5xx, carrier queue overflow, network blips) are retried; permanent
    ones (invalid number, blocked, unsubscribed) are not."""
    status = getattr(exc, "status", None)
    code = getattr(exc, "code", None)
    # Permanent client errors we must NOT retry (invalid/undeliverable number,
    # blocked, opted-out, unreachable region, etc.).
    if code in (21211, 21214, 21408, 21610, 21612, 21614, 30003, 30005, 30006):
        return False
    if status in (429, 500, 502, 503, 504):
        return True
    if code in (20429, 20503, 30001, 30022, 14107):  # rate limit / queue overflow
        return True
    # No HTTP status usually means a network/connection error — retry once.
    if status is None:
        return True
    return False


def send_sms_ex(to: str, body: str, status_callback: Optional[str] = None, media_urls: Optional[list] = None) -> Optional[str]:
    """Send an SMS/MMS and return the Twilio message SID (or None on failure). Never raises.

    If `media_urls` (list of public HTTPS URLs) is provided, the message is sent as
    an MMS with those attachments inline (Twilio accepts up to 10). Twilio auto-resizes
    images; the content type is inferred from each URL's Content-Type header.

    Transient Twilio errors are retried a few times with a short randomized
    backoff so a spurious first-attempt failure doesn't get reported as failed.
    """
    client = _get_client()
    from_number = os.getenv("TWILIO_PHONE_NUMBER")
    if not client or not from_number:
        return None
    dest = normalize_us_phone(to)
    if not dest:
        logger.warning("send_sms: invalid destination number")
        return None
    return _send_one_detailed(to, body, status_callback, media_urls).get("sid")


# ---- human-readable Twilio delivery error messages -------------------------
_HUMAN_ERRORS = {
    "invalid": "Not a valid mobile number",
    21211: "Not a valid phone number",
    21214: "Not a valid phone number",
    21217: "Not a valid phone number",
    21408: "Can't text this region yet",
    21610: "Unsubscribed — they texted STOP",
    21612: "This number can't receive our texts",
    21614: "Not a mobile number (can't get SMS)",
    30003: "Phone unreachable or turned off",
    30004: "Blocked by the carrier",
    30005: "Unknown or inactive number",
    30006: "Landline or unreachable carrier",
    30007: "Carrier flagged it as spam",
    30034: "Number not registered for texting",
}


def human_error(code, fallback: str = "") -> str:
    """Map a Twilio ErrorCode (int or str) to a short, parent-friendly reason."""
    if code in _HUMAN_ERRORS:
        return _HUMAN_ERRORS[code]
    try:
        ic = int(code)
        if ic in _HUMAN_ERRORS:
            return _HUMAN_ERRORS[ic]
    except (TypeError, ValueError):
        pass
    return (fallback or "").strip() or "Couldn't be delivered"


def _send_one_detailed(to: str, body: str, status_callback: Optional[str] = None, media_urls: Optional[list] = None) -> dict:
    """Send one SMS/MMS; never raises. Returns a dict:
    {sid, error_code, error_message, attempts}. `sid` is None on failure.
    Transient errors are retried; `attempts` reflects how many tries it took."""
    client = _get_client()
    from_number = os.getenv("TWILIO_PHONE_NUMBER")
    if not client or not from_number:
        return {"sid": None, "error_code": None, "error_message": "SMS isn't set up", "attempts": 0}
    dest = normalize_us_phone(to)
    if not dest:
        return {"sid": None, "error_code": "invalid", "error_message": human_error("invalid"), "attempts": 0}
    signed = body if "Sent using CheerPlanner" in (body or "") else f"{body}\n\nSent using CheerPlanner"
    kwargs = {"to": dest, "from_": from_number, "body": signed}
    if status_callback:
        kwargs["status_callback"] = status_callback
    if media_urls:
        kwargs["media_url"] = list(media_urls)[:10]
    last_code = None
    last_msg = None
    for attempt in range(_MAX_SEND_ATTEMPTS):
        try:
            msg = client.messages.create(**kwargs)
            sid = getattr(msg, "sid", None)
            logger.info("SMS sent sid=%s to=%s media=%d attempt=%d", sid, dest, len(media_urls or []), attempt + 1)
            return {"sid": sid, "error_code": None, "error_message": None, "attempts": attempt + 1}
        except Exception as exc:  # noqa: BLE001
            last_code = getattr(exc, "code", None)
            last_msg = getattr(exc, "msg", None) or str(exc)
            if attempt < _MAX_SEND_ATTEMPTS - 1 and _is_retryable(exc):
                delay = 0.6 * (attempt + 1) + random.uniform(0, 0.4)
                logger.info("send_sms retrying to=%s (attempt %d) after transient error: %s", dest, attempt + 1, exc)
                time.sleep(delay)
                continue
            logger.warning("send_sms failed to=%s (attempt %d): %s", dest, attempt + 1, exc)
            return {"sid": None, "error_code": last_code, "error_message": human_error(last_code, last_msg), "attempts": attempt + 1}
    return {"sid": None, "error_code": last_code, "error_message": human_error(last_code, last_msg), "attempts": _MAX_SEND_ATTEMPTS}


async def _run_bulk(items: list) -> list:
    """Shared fan-out: returns a list of detail dicts in the same order as items."""
    if not items:
        return []
    sem = asyncio.Semaphore(_SEND_CONCURRENCY)

    async def _one(it: dict):
        async with sem:
            return await asyncio.to_thread(
                _send_one_detailed,
                it.get("to"),
                it.get("body") or "",
                it.get("status_callback"),
                it.get("media_urls"),
            )

    return await asyncio.gather(*(_one(it) for it in items))


async def send_bulk(items: list) -> list:
    """Send many SMS/MMS concurrently; returns message SIDs (or None) in order.
    Backward-compatible helper used across reminder routers."""
    return [d.get("sid") for d in await _run_bulk(items)]


async def send_bulk_detailed(items: list) -> list:
    """Like send_bulk but returns full {sid, error_code, error_message, attempts}
    dicts per item — used by broadcasts to show delivery receipts, failure
    reasons, and auto-retry notices."""
    return await _run_bulk(items)


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
