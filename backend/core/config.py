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

# Daily digest is sent at 8 AM in this timezone (UTC by default).
# When per-user timezones are added we can override at job-build time.
DIGEST_SEND_HOUR_UTC = int(os.environ.get("DIGEST_SEND_HOUR_UTC", "13"))  # 8 AM US Eastern ~ 13 UTC
