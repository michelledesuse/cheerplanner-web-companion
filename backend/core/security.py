from datetime import datetime, timezone, timedelta
from hashlib import sha256
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
from slowapi import Limiter
from slowapi.util import get_remote_address
import jwt

from core.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRE_MINUTES, ADMIN_EMAILS, REDEMPTION_PEPPER
from core.db import db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security_scheme = HTTPBearer(auto_error=False)
limiter = Limiter(key_func=get_remote_address)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": user_id, "email": email, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = creds.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return user_doc


async def require_team_access(current_user=Depends(get_current_user)) -> dict:
    """Gate Team Hub endpoints to logins that have self-identified as personnel
    (coach / team rep / staff). Keeps the hub private within a shared household."""
    if not current_user.get("team_access"):
        raise HTTPException(status_code=403, detail="Team Hub access is limited to team personnel")
    return current_user


async def require_admin(current_user=Depends(get_current_user)) -> dict:
    """Gate admin-only endpoints. Admin status is set server-side only
    (seeded from ADMIN_EMAILS); the client can never self-grant it."""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user


def code_hash(code: str) -> str:
    """sha256(pepper:code) — codes are stored hashed, never plaintext."""
    return sha256(f"{REDEMPTION_PEPPER}:{code.strip()}".encode()).hexdigest()


async def seed_admins() -> None:
    """Idempotently flag ADMIN_EMAILS accounts as admin at startup."""
    for email in ADMIN_EMAILS:
        await db.users.update_one({"email": email}, {"$set": {"is_admin": True}})
