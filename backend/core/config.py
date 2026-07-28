import os
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "cheertrack-dev-secret-change-me-32b!")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

# Password-reset and unsubscribe tokens are short-lived and signed
# with the same JWT_SECRET but under a distinct issuer so they can't
# be confused with auth tokens.
PASSWORD_RESET_EXPIRE_MINUTES = 30
UNSUBSCRIBE_EXPIRE_DAYS = 365  # opt-out should keep working for ~1 year

# ---------- SendGrid ----------
SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "info@cheer-planner.com")
SENDER_NAME = os.environ.get("SENDER_NAME", "CheerPlanner Reminders")

# ---------- Deep links / email URLs ----------
APP_URL_SCHEME = os.environ.get("APP_URL_SCHEME", "cheerplanner")
WEB_FALLBACK_URL = os.environ.get("WEB_FALLBACK_URL", "https://cheer-planner.com").rstrip("/")
# Public URL of THIS backend (used for email fallback links and unsubscribe).
# When unset we fall back to WEB_FALLBACK_URL so dev/local still works.
BACKEND_PUBLIC_URL = (os.environ.get("BACKEND_PUBLIC_URL") or WEB_FALLBACK_URL).rstrip("/")

# ---------- Admin / entitlements ----------
# Comma-separated list of emails granted admin (seeded idempotently at startup).
ADMIN_EMAILS = [
    e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()
]
# Server-side pepper mixed into the sha256 of Lifetime codes before storage.
REDEMPTION_PEPPER = os.environ.get("REDEMPTION_PEPPER", "cheerplanner-dev-pepper-change-me")
# Public URL where beta testers redeem Lifetime codes (web portal, Apple-compliant).
REDEMPTION_PORTAL_URL = (os.environ.get("REDEMPTION_PORTAL_URL") or f"{BACKEND_PUBLIC_URL}/api/redeem").rstrip("/")

# ---------- RevenueCat (Apple IAP subscriptions) ----------
# Webhook Authorization header shared secret (server-side ONLY). The public
# client SDK key lives in the frontend .env (EXPO_PUBLIC_REVENUECAT_IOS_SDK_KEY).
REVENUECAT_WEBHOOK_AUTH = os.environ.get("REVENUECAT_WEBHOOK_AUTH", "")

# ---------- Monetization go-live ----------
# Until this date (UTC), the app behaves as fully unlocked for EVERYONE: no
# feature gating, no paywalls, no household limits. On/after this date the
# Free/Premium tiers take effect automatically. Change the env value to reschedule.
MONETIZATION_START = os.environ.get("MONETIZATION_START", "2026-08-15")


def monetization_active() -> bool:
    """True once we've reached MONETIZATION_START (UTC). Before then, gating is off."""
    from datetime import datetime, timezone
    raw = (MONETIZATION_START or "").strip()
    if not raw:
        return True
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) >= dt
    except Exception:
        return True



# Daily digest is sent at 8 AM in this timezone (UTC by default).
# When per-user timezones are added we can override at job-build time.
DIGEST_SEND_HOUR_UTC = int(os.environ.get("DIGEST_SEND_HOUR_UTC", "13"))  # 8 AM US Eastern ~ 13 UTC
