import os
import uuid
import logging
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from typing import List, Optional, Literal, Dict

from fastapi import FastAPI, APIRouter, HTTPException, status, Depends, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pydantic import BaseModel, Field, EmailStr
from passlib.context import CryptContext
import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

import import_helpers


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------- Config ----------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "cheertrack-dev-secret-change-me-32b!")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security_scheme = HTTPBearer(auto_error=False)

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="CheerPlanner API")
app.state.limiter = limiter

api_router = APIRouter(prefix="/api")

# ---------- Logging ----------
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ============================================================
# Models
# ============================================================
def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class UserSignup(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: Optional[str] = None
    created_at: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class Athlete(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    team: Optional[str] = None
    gym: Optional[str] = None
    avatar_color: Optional[str] = "#E11D48"
    competition_ids: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)


class AthleteCreate(BaseModel):
    name: str
    team: Optional[str] = None
    gym: Optional[str] = None
    avatar_color: Optional[str] = "#E11D48"
    competition_ids: Optional[List[str]] = None


class AthleteUpdate(BaseModel):
    name: Optional[str] = None
    team: Optional[str] = None
    gym: Optional[str] = None
    avatar_color: Optional[str] = None
    competition_ids: Optional[List[str]] = None


ExpenseCategory = Literal[
    "Tuition", "Practice", "Gear", "Comp/Choreo", "Camp", "Uniform",
    "Classes & Privates", "Bow", "Warm-Up & Bag", "End of Season Comp Fees",
    "Late Fees", "Misc",
]

EXPENSE_CATEGORIES = [
    "Tuition", "Practice", "Gear", "Comp/Choreo", "Camp", "Uniform",
    "Classes & Privates", "Bow", "Warm-Up & Bag", "End of Season Comp Fees",
    "Late Fees", "Misc",
]


class ExpenseEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    athlete_id: str
    category: str
    amount: float
    note: Optional[str] = None
    incurred_on: str  # ISO date
    due_date: Optional[str] = None
    paid: bool = False
    created_at: str = Field(default_factory=utcnow_iso)


class ExpenseCreate(BaseModel):
    athlete_id: str
    category: str
    amount: float
    note: Optional[str] = None
    incurred_on: str
    due_date: Optional[str] = None
    paid: bool = False


class ExpenseUpdate(BaseModel):
    category: Optional[str] = None
    amount: Optional[float] = None
    note: Optional[str] = None
    incurred_on: Optional[str] = None
    due_date: Optional[str] = None
    paid: Optional[bool] = None


class PaymentEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    athlete_id: str
    amount: float
    paid_on: str
    method: Optional[str] = None
    note: Optional[str] = None
    applied_expense_ids: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)


class PaymentCreate(BaseModel):
    athlete_id: str
    amount: float
    paid_on: str
    method: Optional[str] = None
    note: Optional[str] = None
    applied_expense_ids: List[str] = Field(default_factory=list)


class PaymentUpdate(BaseModel):
    amount: Optional[float] = None
    paid_on: Optional[str] = None
    method: Optional[str] = None
    note: Optional[str] = None
    applied_expense_ids: Optional[List[str]] = None


class Competition(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    location: Optional[str] = None
    event_date: str  # ISO date
    end_date: Optional[str] = None
    housing_required: bool = False
    booking_link: Optional[str] = None
    booking_release_at: Optional[str] = None  # ISO datetime
    notes: Optional[str] = None
    created_at: str = Field(default_factory=utcnow_iso)


class CompetitionCreate(BaseModel):
    name: str
    location: Optional[str] = None
    event_date: str
    end_date: Optional[str] = None
    housing_required: bool = False
    booking_link: Optional[str] = None
    booking_release_at: Optional[str] = None
    notes: Optional[str] = None


class CompetitionUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    event_date: Optional[str] = None
    end_date: Optional[str] = None
    housing_required: Optional[bool] = None
    booking_link: Optional[str] = None
    booking_release_at: Optional[str] = None
    notes: Optional[str] = None


BookingType = Literal["hotel", "car", "flight"]


class Booking(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    competition_id: str
    type: str  # hotel | car | flight
    # common
    provider: Optional[str] = None  # hotel name / rental car company / airline
    confirmation: Optional[str] = None
    cost: Optional[float] = 0.0
    amount_paid: Optional[float] = 0.0
    balance_due_date: Optional[str] = None
    notes: Optional[str] = None
    # hotel
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    cancel_by: Optional[str] = None
    # flight
    flight_number: Optional[str] = None
    depart_airport: Optional[str] = None
    arrive_airport: Optional[str] = None
    depart_time: Optional[str] = None
    arrive_time: Optional[str] = None
    return_flight_number: Optional[str] = None
    return_depart_airport: Optional[str] = None
    return_arrive_airport: Optional[str] = None
    return_depart_time: Optional[str] = None
    return_arrive_time: Optional[str] = None

    created_at: str = Field(default_factory=utcnow_iso)


class BookingCreate(BaseModel):
    competition_id: str
    type: str
    provider: Optional[str] = None
    confirmation: Optional[str] = None
    cost: Optional[float] = 0.0
    amount_paid: Optional[float] = 0.0
    balance_due_date: Optional[str] = None
    notes: Optional[str] = None
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    cancel_by: Optional[str] = None
    flight_number: Optional[str] = None
    depart_airport: Optional[str] = None
    arrive_airport: Optional[str] = None
    depart_time: Optional[str] = None
    arrive_time: Optional[str] = None
    return_flight_number: Optional[str] = None
    return_depart_airport: Optional[str] = None
    return_arrive_airport: Optional[str] = None
    return_depart_time: Optional[str] = None
    return_arrive_time: Optional[str] = None


class BookingUpdate(BaseModel):
    provider: Optional[str] = None
    confirmation: Optional[str] = None
    cost: Optional[float] = None
    amount_paid: Optional[float] = None
    balance_due_date: Optional[str] = None
    notes: Optional[str] = None
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    cancel_by: Optional[str] = None
    flight_number: Optional[str] = None
    depart_airport: Optional[str] = None
    arrive_airport: Optional[str] = None
    depart_time: Optional[str] = None
    arrive_time: Optional[str] = None
    return_flight_number: Optional[str] = None
    return_depart_airport: Optional[str] = None
    return_arrive_airport: Optional[str] = None
    return_depart_time: Optional[str] = None
    return_arrive_time: Optional[str] = None


class Fundraiser(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    athlete_id: Optional[str] = None  # null = household-level
    name: str
    amount_raised: float = 0.0
    raised_on: str
    note: Optional[str] = None
    created_at: str = Field(default_factory=utcnow_iso)


class FundraiserCreate(BaseModel):
    athlete_id: Optional[str] = None
    name: str
    amount_raised: float = 0.0
    raised_on: str
    note: Optional[str] = None


# ============================================================
# Auth utils
# ============================================================
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


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)) -> dict:
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


# ============================================================
# Auth routes
# ============================================================
@api_router.get("/")
async def root():
    return {"message": "CheerPlanner API", "ok": True}


@api_router.post("/auth/signup", response_model=TokenResponse)
@limiter.limit("10/minute")
async def signup(request: Request, payload: UserSignup):
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "created_at": utcnow_iso(),
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, email)
    return TokenResponse(
        access_token=token,
        user=UserPublic(id=user_id, email=email, name=payload.name, created_at=user_doc["created_at"]),
    )


@api_router.post("/auth/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, payload: UserLogin):
    email = payload.email.lower().strip()
    user_doc = await db.users.find_one({"email": email})
    if not user_doc or not verify_password(payload.password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user_doc["id"], email)
    return TokenResponse(
        access_token=token,
        user=UserPublic(
            id=user_doc["id"], email=email, name=user_doc.get("name"), created_at=user_doc["created_at"]
        ),
    )


@api_router.get("/auth/me", response_model=UserPublic)
async def me(current_user=Depends(get_current_user)):
    return UserPublic(
        id=current_user["id"],
        email=current_user["email"],
        name=current_user.get("name"),
        created_at=current_user["created_at"],
    )


# ============================================================
# Athletes
# ============================================================
@api_router.get("/athletes", response_model=List[Athlete])
async def list_athletes(current_user=Depends(get_current_user)):
    docs = await db.athletes.find({"user_id": current_user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [Athlete(**d) for d in docs]


@api_router.post("/athletes", response_model=Athlete)
async def create_athlete(payload: AthleteCreate, current_user=Depends(get_current_user)):
    # exclude None so Pydantic can apply default_factory (e.g. competition_ids=[])
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    athlete = Athlete(user_id=current_user["id"], **data)
    await db.athletes.insert_one(athlete.model_dump())
    return athlete


@api_router.patch("/athletes/{athlete_id}", response_model=Athlete)
async def update_athlete(athlete_id: str, payload: AthleteUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.athletes.update_one(
        {"id": athlete_id, "user_id": current_user["id"]}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    doc = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    return Athlete(**doc)


@api_router.delete("/athletes/{athlete_id}")
async def delete_athlete(athlete_id: str, current_user=Depends(get_current_user)):
    res = await db.athletes.delete_one({"id": athlete_id, "user_id": current_user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    await db.expenses.delete_many({"athlete_id": athlete_id, "user_id": current_user["id"]})
    await db.payments.delete_many({"athlete_id": athlete_id, "user_id": current_user["id"]})
    return {"deleted": True}


# ============================================================
# Expenses
# ============================================================
@api_router.get("/expenses/categories")
async def expense_categories():
    return {"categories": EXPENSE_CATEGORIES}


@api_router.get("/expenses", response_model=List[ExpenseEntry])
async def list_expenses(
    athlete_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    q = {"user_id": current_user["id"]}
    if athlete_id:
        q["athlete_id"] = athlete_id
    docs = await db.expenses.find(q, {"_id": 0}).sort("incurred_on", -1).to_list(2000)
    return [ExpenseEntry(**d) for d in docs]


@api_router.post("/expenses", response_model=ExpenseEntry)
async def create_expense(payload: ExpenseCreate, current_user=Depends(get_current_user)):
    entry = ExpenseEntry(user_id=current_user["id"], **payload.model_dump())
    await db.expenses.insert_one(entry.model_dump())
    return entry


@api_router.patch("/expenses/{expense_id}", response_model=ExpenseEntry)
async def update_expense(expense_id: str, payload: ExpenseUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.expenses.update_one(
        {"id": expense_id, "user_id": current_user["id"]}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    doc = await db.expenses.find_one({"id": expense_id}, {"_id": 0})
    return ExpenseEntry(**doc)


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current_user=Depends(get_current_user)):
    res = await db.expenses.delete_one({"id": expense_id, "user_id": current_user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"deleted": True}


# ============================================================
# Payments
# ============================================================
@api_router.get("/payments", response_model=List[PaymentEntry])
async def list_payments(athlete_id: Optional[str] = None, current_user=Depends(get_current_user)):
    q = {"user_id": current_user["id"]}
    if athlete_id:
        q["athlete_id"] = athlete_id
    docs = await db.payments.find(q, {"_id": 0}).sort("paid_on", -1).to_list(2000)
    return [PaymentEntry(**d) for d in docs]


@api_router.post("/payments", response_model=PaymentEntry)
async def create_payment(payload: PaymentCreate, current_user=Depends(get_current_user)):
    entry = PaymentEntry(user_id=current_user["id"], **payload.model_dump())
    await db.payments.insert_one(entry.model_dump())
    # Auto-mark linked expenses as paid
    if entry.applied_expense_ids:
        await db.expenses.update_many(
            {"id": {"$in": entry.applied_expense_ids}, "user_id": current_user["id"]},
            {"$set": {"paid": True}},
        )
    return entry


@api_router.patch("/payments/{payment_id}", response_model=PaymentEntry)
async def update_payment(payment_id: str, payload: PaymentUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.payments.update_one(
        {"id": payment_id, "user_id": current_user["id"]}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Payment not found")
    doc = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    return PaymentEntry(**doc)


@api_router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, current_user=Depends(get_current_user)):
    res = await db.payments.delete_one({"id": payment_id, "user_id": current_user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"deleted": True}


# ============================================================
# Competitions
# ============================================================
@api_router.get("/competitions", response_model=List[Competition])
async def list_competitions(current_user=Depends(get_current_user)):
    docs = await db.competitions.find({"user_id": current_user["id"]}, {"_id": 0}).sort("event_date", 1).to_list(500)
    return [Competition(**d) for d in docs]


@api_router.post("/competitions", response_model=Competition)
async def create_competition(payload: CompetitionCreate, current_user=Depends(get_current_user)):
    comp = Competition(user_id=current_user["id"], **payload.model_dump())
    await db.competitions.insert_one(comp.model_dump())
    return comp


@api_router.get("/competitions/{competition_id}", response_model=Competition)
async def get_competition(competition_id: str, current_user=Depends(get_current_user)):
    doc = await db.competitions.find_one(
        {"id": competition_id, "user_id": current_user["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Competition not found")
    return Competition(**doc)


@api_router.patch("/competitions/{competition_id}", response_model=Competition)
async def update_competition(competition_id: str, payload: CompetitionUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.competitions.update_one(
        {"id": competition_id, "user_id": current_user["id"]}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Competition not found")
    doc = await db.competitions.find_one({"id": competition_id}, {"_id": 0})
    return Competition(**doc)


@api_router.delete("/competitions/{competition_id}")
async def delete_competition(competition_id: str, current_user=Depends(get_current_user)):
    res = await db.competitions.delete_one(
        {"id": competition_id, "user_id": current_user["id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Competition not found")
    await db.bookings.delete_many({"competition_id": competition_id, "user_id": current_user["id"]})
    return {"deleted": True}


# ============================================================
# Bookings
# ============================================================
@api_router.get("/bookings", response_model=List[Booking])
async def list_bookings(
    competition_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    q = {"user_id": current_user["id"]}
    if competition_id:
        q["competition_id"] = competition_id
    docs = await db.bookings.find(q, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [Booking(**d) for d in docs]


@api_router.post("/bookings", response_model=Booking)
async def create_booking(payload: BookingCreate, current_user=Depends(get_current_user)):
    if payload.type not in ("hotel", "car", "flight"):
        raise HTTPException(status_code=400, detail="Invalid booking type")
    booking = Booking(user_id=current_user["id"], **payload.model_dump())
    await db.bookings.insert_one(booking.model_dump())
    return booking


@api_router.patch("/bookings/{booking_id}", response_model=Booking)
async def update_booking(booking_id: str, payload: BookingUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.bookings.update_one(
        {"id": booking_id, "user_id": current_user["id"]}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    doc = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    return Booking(**doc)


@api_router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, current_user=Depends(get_current_user)):
    res = await db.bookings.delete_one({"id": booking_id, "user_id": current_user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"deleted": True}


# ============================================================
# Fundraisers
# ============================================================
@api_router.get("/fundraisers", response_model=List[Fundraiser])
async def list_fundraisers(current_user=Depends(get_current_user)):
    docs = await db.fundraisers.find({"user_id": current_user["id"]}, {"_id": 0}).sort("raised_on", -1).to_list(1000)
    return [Fundraiser(**d) for d in docs]


@api_router.post("/fundraisers", response_model=Fundraiser)
async def create_fundraiser(payload: FundraiserCreate, current_user=Depends(get_current_user)):
    fr = Fundraiser(user_id=current_user["id"], **payload.model_dump())
    await db.fundraisers.insert_one(fr.model_dump())
    return fr


@api_router.delete("/fundraisers/{fundraiser_id}")
async def delete_fundraiser(fundraiser_id: str, current_user=Depends(get_current_user)):
    res = await db.fundraisers.delete_one({"id": fundraiser_id, "user_id": current_user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fundraiser not found")
    return {"deleted": True}


# ============================================================
# Reminders & Dashboard
# ============================================================
def parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        # try date or datetime
        if "T" in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        return date.fromisoformat(s[:10])
    except Exception:
        return None


@api_router.get("/reminders")
async def reminders(current_user=Depends(get_current_user)):
    """Returns a list of upcoming due items: expense due_date, booking balance_due_date,
    competition booking_release_at, and competition event_date. Each item has urgency level."""
    today = datetime.now(timezone.utc).date()
    items = []

    # Unpaid expenses with due date
    async for d in db.expenses.find(
        {"user_id": current_user["id"], "due_date": {"$ne": None}, "paid": False}, {"_id": 0}
    ):
        due = parse_date(d.get("due_date"))
        if not due:
            continue
        delta = (due - today).days
        items.append({
            "id": f"expense:{d['id']}",
            "kind": "expense",
            "title": f"{d.get('category')} payment",
            "subtitle": d.get("note") or "",
            "amount": d.get("amount"),
            "due_date": d.get("due_date"),
            "days_until": delta,
            "ref_id": d["id"],
            "athlete_id": d.get("athlete_id"),
        })

    # Bookings with balance_due_date and balance > 0
    async for d in db.bookings.find(
        {"user_id": current_user["id"], "balance_due_date": {"$ne": None}}, {"_id": 0}
    ):
        due = parse_date(d.get("balance_due_date"))
        if not due:
            continue
        balance = float(d.get("cost") or 0) - float(d.get("amount_paid") or 0)
        if balance <= 0:
            continue
        delta = (due - today).days
        items.append({
            "id": f"booking:{d['id']}",
            "kind": "booking",
            "title": f"{d.get('type','').title()} balance: {d.get('provider') or ''}",
            "subtitle": d.get("notes") or "",
            "amount": balance,
            "due_date": d.get("balance_due_date"),
            "days_until": delta,
            "ref_id": d["id"],
            "competition_id": d.get("competition_id"),
        })

    # Booking release datetimes for competitions
    async for d in db.competitions.find(
        {"user_id": current_user["id"], "booking_release_at": {"$ne": None}}, {"_id": 0}
    ):
        rel = parse_date(d.get("booking_release_at"))
        if not rel:
            continue
        delta = (rel - today).days
        if delta < -1:
            continue
        items.append({
            "id": f"release:{d['id']}",
            "kind": "booking_release",
            "title": f"Booking opens: {d.get('name')}",
            "subtitle": d.get("location") or "",
            "amount": None,
            "due_date": d.get("booking_release_at"),
            "days_until": delta,
            "ref_id": d["id"],
        })

    # Cancel-by dates for hotels
    async for d in db.bookings.find(
        {"user_id": current_user["id"], "cancel_by": {"$ne": None}, "type": "hotel"}, {"_id": 0}
    ):
        cb = parse_date(d.get("cancel_by"))
        if not cb:
            continue
        delta = (cb - today).days
        if delta < -1 or delta > 30:
            continue
        items.append({
            "id": f"cancel:{d['id']}",
            "kind": "cancel_by",
            "title": f"Cancel deadline: {d.get('provider') or 'Hotel'}",
            "subtitle": "Free cancel by",
            "amount": None,
            "due_date": d.get("cancel_by"),
            "days_until": delta,
            "ref_id": d["id"],
            "competition_id": d.get("competition_id"),
        })

    items.sort(key=lambda x: (x["days_until"] if x["days_until"] is not None else 9999))
    return {"items": items, "today": today.isoformat()}


@api_router.get("/dashboard")
async def dashboard(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    today = datetime.now(timezone.utc).date()

    athletes_count = await db.athletes.count_documents({"user_id": user_id})
    comps_count = await db.competitions.count_documents({"user_id": user_id})

    # Total expenses & payments YTD
    total_expenses = 0.0
    async for d in db.expenses.find({"user_id": user_id}, {"_id": 0, "amount": 1}).limit(20000):
        total_expenses += float(d.get("amount") or 0)

    total_payments = 0.0
    async for d in db.payments.find({"user_id": user_id}, {"_id": 0, "amount": 1}).limit(20000):
        total_payments += float(d.get("amount") or 0)

    # Booking balances
    booking_balance = 0.0
    async for d in db.bookings.find({"user_id": user_id}, {"_id": 0, "cost": 1, "amount_paid": 1}).limit(5000):
        booking_balance += float(d.get("cost") or 0) - float(d.get("amount_paid") or 0)

    # Unpaid expense balance
    unpaid_expense_balance = 0.0
    async for d in db.expenses.find({"user_id": user_id, "paid": False}, {"_id": 0, "amount": 1}).limit(20000):
        unpaid_expense_balance += float(d.get("amount") or 0)

    # Next competition
    next_comp = None
    async for d in db.competitions.find({"user_id": user_id}, {"_id": 0}).sort("event_date", 1):
        ed = parse_date(d.get("event_date"))
        if ed and ed >= today:
            next_comp = d
            break

    # Fundraisers total
    total_raised = 0.0
    async for d in db.fundraisers.find({"user_id": user_id}, {"_id": 0, "amount_raised": 1}).limit(5000):
        total_raised += float(d.get("amount_raised") or 0)

    # This month spend (DB-level prefix match on incurred_on YYYY-MM)
    this_month = today.strftime("%Y-%m")
    month_spend = 0.0
    async for d in db.expenses.find(
        {"user_id": user_id, "incurred_on": {"$regex": f"^{this_month}"}},
        {"_id": 0, "amount": 1},
    ).limit(20000):
        month_spend += float(d.get("amount") or 0)

    return {
        "athletes_count": athletes_count,
        "competitions_count": comps_count,
        "total_expenses_ytd": round(total_expenses, 2),
        "total_payments_ytd": round(total_payments, 2),
        "outstanding_balance": round(unpaid_expense_balance + booking_balance, 2),
        "booking_balance": round(booking_balance, 2),
        "unpaid_expense_balance": round(unpaid_expense_balance, 2),
        "month_spend": round(month_spend, 2),
        "total_raised": round(total_raised, 2),
        "next_competition": next_comp,
    }


# ============================================================
# Imports (spreadsheet bulk upload)
# ============================================================
ALLOWED_IMPORT_KINDS = {"competitions", "travel", "expenses"}


@api_router.get("/import/template/{kind}")
async def import_template(kind: str, current_user=Depends(get_current_user)):
    if kind not in ALLOWED_IMPORT_KINDS:
        raise HTTPException(status_code=400, detail="Unknown template")
    csv_text = import_helpers.render_template_csv(kind)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="cheerplanner-{kind}-template.csv"'},
    )


@api_router.post("/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    kind: str = Form(...),
    current_user=Depends(get_current_user),
):
    if kind not in ALLOWED_IMPORT_KINDS:
        raise HTTPException(status_code=400, detail="Unknown import kind")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        if kind == "competitions":
            rows = import_helpers.parse_competitions(file.filename or "upload", content)
            return {"kind": kind, "rows": rows, "count": len(rows)}
        if kind == "travel":
            rows = import_helpers.parse_travel(file.filename or "upload", content)
            # also get existing competition names for matching
            existing = await db.competitions.find({"user_id": current_user["id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            return {"kind": kind, "rows": rows, "count": len(rows), "existing_competitions": existing}
        if kind == "expenses":
            data = import_helpers.parse_expenses(file.filename or "upload", content)
            existing_athletes = await db.athletes.find({"user_id": current_user["id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            return {
                "kind": kind,
                "format": data["format"],
                "rows": data["rows"],
                "athlete_columns": data["athlete_columns"],
                "count": len(data["rows"]),
                "existing_athletes": existing_athletes,
            }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("Import parse failed")
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")


class ImportCommitPayload(BaseModel):
    kind: str
    rows: List[dict] = Field(default_factory=list)
    # for expenses wide-form: map of column-name -> athlete_id (existing) or "__new__:<NewName>"
    athlete_map: Optional[Dict[str, str]] = None
    # for travel: optional mapping competition-name -> competition_id
    competition_map: Optional[Dict[str, str]] = None
    # toggle: create competitions that are missing (travel)
    create_missing_competitions: bool = True


@api_router.post("/import/commit")
async def import_commit(payload: ImportCommitPayload, current_user=Depends(get_current_user)):
    if payload.kind not in ALLOWED_IMPORT_KINDS:
        raise HTTPException(status_code=400, detail="Unknown import kind")
    user_id = current_user["id"]

    created = 0
    skipped = 0
    warnings: List[str] = []

    if payload.kind == "competitions":
        for row in payload.rows:
            name = (row.get("name") or "").strip()
            event_date = row.get("event_date")
            if not name or not event_date:
                skipped += 1
                continue
            comp = Competition(
                user_id=user_id,
                name=name,
                location=row.get("location"),
                event_date=event_date,
                end_date=row.get("end_date"),
                housing_required=bool(row.get("housing_required")),
                booking_link=row.get("booking_link"),
                booking_release_at=row.get("booking_release_at"),
                notes=row.get("notes"),
            )
            await db.competitions.insert_one(comp.model_dump())
            created += 1
        return {"created": created, "skipped": skipped, "warnings": warnings}

    if payload.kind == "travel":
        # Build name → id map of existing competitions (case-insensitive)
        existing = await db.competitions.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1, "event_date": 1}).to_list(500)
        name_to_id = {str(c["name"]).strip().lower(): c["id"] for c in existing}
        # apply explicit map
        explicit = payload.competition_map or {}
        for row in payload.rows:
            cname = (row.get("competition") or "").strip()
            if not cname:
                skipped += 1
                continue
            comp_id = explicit.get(cname) or name_to_id.get(cname.lower())
            if not comp_id:
                if payload.create_missing_competitions:
                    comp = Competition(
                        user_id=user_id,
                        name=cname,
                        event_date=datetime.now(timezone.utc).date().isoformat(),
                    )
                    await db.competitions.insert_one(comp.model_dump())
                    comp_id = comp.id
                    name_to_id[cname.lower()] = comp_id
                    warnings.append(f"Created placeholder competition '{cname}' — please set the event date.")
                else:
                    skipped += 1
                    warnings.append(f"Skipped row for unknown competition '{cname}'.")
                    continue
            for b in row.get("bookings", []) or []:
                booking = Booking(
                    user_id=user_id,
                    competition_id=comp_id,
                    type=b.get("type"),
                    provider=b.get("provider"),
                    confirmation=b.get("confirmation"),
                    cost=b.get("cost") or 0,
                    amount_paid=b.get("amount_paid") or 0,
                    balance_due_date=b.get("balance_due_date"),
                    check_in=b.get("check_in"),
                    check_out=b.get("check_out"),
                    cancel_by=b.get("cancel_by"),
                    flight_number=b.get("flight_number"),
                    depart_time=b.get("depart_time"),
                    arrive_time=b.get("arrive_time"),
                    return_flight_number=b.get("return_flight_number"),
                    return_depart_time=b.get("return_depart_time"),
                    return_arrive_time=b.get("return_arrive_time"),
                )
                await db.bookings.insert_one(booking.model_dump())
                created += 1
        return {"created": created, "skipped": skipped, "warnings": warnings}

    if payload.kind == "expenses":
        # Resolve athlete map first
        athlete_map = payload.athlete_map or {}
        # For long-form: athlete name → id (auto-create unknown)
        # For wide-form: athlete column → athlete_id or "__new__:<Name>"
        existing = await db.athletes.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        name_to_id = {a["name"].strip().lower(): a["id"] for a in existing}
        resolved: Dict[str, str] = {}

        for key, val in athlete_map.items():
            if not val:
                continue
            if val.startswith("__new__"):
                new_name = val.split(":", 1)[1] if ":" in val else key
                athlete = Athlete(user_id=user_id, name=new_name)
                await db.athletes.insert_one(athlete.model_dump())
                resolved[key] = athlete.id
                name_to_id[new_name.strip().lower()] = athlete.id
            else:
                resolved[key] = val

        for row in payload.rows:
            if "amounts" in row:  # wide form
                d = row.get("date") or datetime.now(timezone.utc).date().isoformat()
                category = row.get("category") or "Misc"
                for col_name, amt in (row.get("amounts") or {}).items():
                    aid = resolved.get(col_name)
                    if not aid:
                        # auto-create athlete if not mapped
                        new_a = Athlete(user_id=user_id, name=col_name)
                        await db.athletes.insert_one(new_a.model_dump())
                        aid = new_a.id
                        resolved[col_name] = aid
                        name_to_id[col_name.strip().lower()] = aid
                    e = ExpenseEntry(
                        user_id=user_id,
                        athlete_id=aid,
                        category=category,
                        amount=float(amt),
                        incurred_on=d,
                    )
                    await db.expenses.insert_one(e.model_dump())
                    created += 1
            else:  # long form
                athlete_name = (row.get("athlete") or "").strip()
                if not athlete_name:
                    skipped += 1
                    continue
                aid = name_to_id.get(athlete_name.lower())
                if not aid:
                    new_a = Athlete(user_id=user_id, name=athlete_name)
                    await db.athletes.insert_one(new_a.model_dump())
                    aid = new_a.id
                    name_to_id[athlete_name.lower()] = aid
                e = ExpenseEntry(
                    user_id=user_id,
                    athlete_id=aid,
                    category=row.get("category") or "Misc",
                    amount=float(row.get("amount") or 0),
                    incurred_on=row.get("date") or datetime.now(timezone.utc).date().isoformat(),
                    due_date=row.get("due_date"),
                    paid=bool(row.get("paid")),
                    note=row.get("note"),
                )
                await db.expenses.insert_one(e.model_dump())
                created += 1
        return {"created": created, "skipped": skipped, "warnings": warnings}


# ============================================================
# Wire-up
# ============================================================
@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests, slow down."})


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
