"""Twilio webhook signature verification.

Twilio signs every webhook request with an ``X-Twilio-Signature`` header: an
HMAC-SHA1 of the full public URL + the sorted POST params, keyed by the account
Auth Token. Validating it proves the request genuinely came from Twilio and
blocks spoofed posts to our public /api/twilio/* endpoints.

Behind the Kubernetes ingress the app sees an internal host, so we rebuild the
public URL from the X-Forwarded-* headers (and an optional explicit override)
and accept the request if ANY candidate URL validates — this tolerates whichever
domain the webhook was configured with in the Twilio console.

When no Auth Token is configured (local/dev), verification is skipped so the
in-app flows keep working; it only enforces once the real token is present
(i.e. in production).
"""
import os
import logging
from typing import Mapping

from fastapi import Request
from twilio.request_validator import RequestValidator

logger = logging.getLogger("core.twilio_verify")


def _candidate_urls(request: Request) -> list[str]:
    """All plausible public URLs Twilio could have signed."""
    path = request.url.path
    query = request.url.query
    suffix = f"{path}?{query}" if query else path

    cands: list[str] = []

    # 1) Explicit override (most reliable if the operator sets it).
    base = os.environ.get("TWILIO_WEBHOOK_BASE_URL")
    if base:
        cands.append(base.rstrip("/") + suffix)

    # 2) Rebuilt from the ingress forwarded headers.
    proto = request.headers.get("x-forwarded-proto")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if host:
        cands.append(f"{(proto or 'https')}://{host}{suffix}")
        # Twilio defaults to https for configured webhooks; try both schemes.
        cands.append(f"https://{host}{suffix}")

    # 3) The raw URL FastAPI saw (last resort).
    cands.append(str(request.url))

    # De-dupe, preserve order.
    seen: set[str] = set()
    out: list[str] = []
    for u in cands:
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def verify_twilio_request(request: Request, form: Mapping[str, str]) -> bool:
    """Return True if the request is a valid Twilio webhook (or verification is
    intentionally skipped because no Auth Token is configured)."""
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN") or ""
    if not auth_token:
        # Dev / not configured — don't block the in-app flow.
        return True

    signature = request.headers.get("x-twilio-signature") or ""
    if not signature:
        logger.warning("Twilio webhook rejected: missing X-Twilio-Signature header")
        return False

    params = {k: v for k, v in form.items()}
    validator = RequestValidator(auth_token)
    for url in _candidate_urls(request):
        try:
            if validator.validate(url, params, signature):
                return True
        except Exception:  # pragma: no cover - defensive
            continue
    logger.warning("Twilio webhook rejected: signature did not match any candidate URL")
    return False
