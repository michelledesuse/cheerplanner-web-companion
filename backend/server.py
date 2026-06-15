import os
import uuid
import logging
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from typing import List, Optional, Literal, Dict, Any

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


class Household(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    member_user_ids: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)


class HouseholdInvite(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    household_id: str
    invited_by: str
    code: str
    expires_at: str
    used_at: Optional[str] = None
    created_at: str = Field(default_factory=utcnow_iso)


class HouseholdJoinRequest(BaseModel):
    code: str


class RecurrenceRule(BaseModel):
    frequency: str  # "daily" | "weekly" | "biweekly" | "monthly"
    days_of_week: List[int] = Field(default_factory=list)  # 0=Sun..6=Sat (weekly/biweekly)
    until: str  # ISO YYYY-MM-DD (inclusive)


class ScheduleEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    athlete_ids: List[str] = Field(default_factory=list)  # empty = all/household
    event_type: str = "practice"  # practice|team_bonding|private_lesson|choreography|class|other
    title: str
    location: Optional[str] = None
    date: str  # ISO YYYY-MM-DD
    start_time: Optional[str] = None  # "18:00"
    end_time: Optional[str] = None
    notes: Optional[str] = None
    series_id: Optional[str] = None  # all events of a recurring series share this id
    recurrence_rule: Optional[RecurrenceRule] = None  # stored on every instance for convenience
    created_at: str = Field(default_factory=utcnow_iso)


class ScheduleEventCreate(BaseModel):
    athlete_ids: List[str] = Field(default_factory=list)
    event_type: str = "practice"
    title: str
    location: Optional[str] = None
    date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    recurrence_rule: Optional[RecurrenceRule] = None


class ScheduleEventUpdate(BaseModel):
    athlete_ids: Optional[List[str]] = None
    event_type: Optional[str] = None
    title: Optional[str] = None
    location: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None


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
    avatar_image: Optional[str] = None  # base64 data URL (e.g. data:image/jpeg;base64,...)
    competition_ids: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)


class AthleteCreate(BaseModel):
    name: str
    team: Optional[str] = None
    gym: Optional[str] = None
    avatar_color: Optional[str] = "#E11D48"
    avatar_image: Optional[str] = None
    competition_ids: Optional[List[str]] = None


class AthleteUpdate(BaseModel):
    name: Optional[str] = None
    team: Optional[str] = None
    gym: Optional[str] = None
    avatar_color: Optional[str] = None
    avatar_image: Optional[str] = None
    competition_ids: Optional[List[str]] = None


ExpenseCategory = Literal[
    "Tuition", "Practice", "Gear", "Comp/Choreo", "Camp", "Uniform",
    "Classes & Privates", "Bow", "Warm-Up & Bag", "End of Season Comp Fees",
    "Registration", "Membership", "Late Fees", "Misc",
]

EXPENSE_CATEGORIES = [
    "Tuition", "Practice", "Gear", "Comp/Choreo", "Camp", "Uniform",
    "Classes & Privates", "Bow", "Warm-Up & Bag", "End of Season Comp Fees",
    "Registration", "Membership", "Late Fees", "Misc",
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
    receipt_image: Optional[str] = None  # base64 data URL
    recurrence_group_id: Optional[str] = None  # links a series of recurring expenses
    # Response-only computed fields (not stored)
    paid_amount: float = 0.0
    balance_due: float = 0.0
    created_at: str = Field(default_factory=utcnow_iso)


class ExpenseCreate(BaseModel):
    athlete_id: str
    category: str
    amount: float
    note: Optional[str] = None
    incurred_on: str
    due_date: Optional[str] = None
    paid: bool = False
    receipt_image: Optional[str] = None
    # Recurrence options (NEW): when set, server creates N additional occurrences
    recurrence: Optional[Literal["monthly", "weekly", "biweekly"]] = None
    recurrence_count: Optional[int] = None  # total entries to create (including this one); default 1


class ExpenseUpdate(BaseModel):
    athlete_id: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    note: Optional[str] = None
    incurred_on: Optional[str] = None
    due_date: Optional[str] = None
    paid: Optional[bool] = None
    receipt_image: Optional[str] = None


class PaymentAllocation(BaseModel):
    expense_id: str
    amount: float


class PaymentEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    athlete_id: str
    amount: float
    paid_on: str
    method: Optional[str] = None
    note: Optional[str] = None
    applied_expense_ids: List[str] = Field(default_factory=list)
    # Optional per-expense breakdown (used by bulk auto-allocation)
    allocations: Optional[List[PaymentAllocation]] = None
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
    event_time: Optional[str] = None  # "HH:MM" 24h (e.g. team performance time)
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
    event_time: Optional[str] = None
    end_date: Optional[str] = None
    housing_required: bool = False
    booking_link: Optional[str] = None
    booking_release_at: Optional[str] = None
    notes: Optional[str] = None


class CompetitionUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    event_date: Optional[str] = None
    event_time: Optional[str] = None
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
    provider: Optional[str] = None  # hotel name / rental car company / outbound airline
    confirmation: Optional[str] = None
    cost: Optional[float] = 0.0
    amount_paid: Optional[float] = 0.0
    balance_due_date: Optional[str] = None
    notes: Optional[str] = None
    # hotel
    check_in: Optional[str] = None
    check_in_time: Optional[str] = None   # "HH:MM" 24h
    check_out: Optional[str] = None
    check_out_time: Optional[str] = None  # "HH:MM" 24h
    cancel_by: Optional[str] = None
    # car
    pickup_at: Optional[str] = None        # "YYYY-MM-DD HH:mm"
    pickup_location: Optional[str] = None
    dropoff_at: Optional[str] = None
    dropoff_location: Optional[str] = None
    # flight - outbound
    flight_number: Optional[str] = None
    depart_airport: Optional[str] = None
    arrive_airport: Optional[str] = None
    depart_time: Optional[str] = None
    arrive_time: Optional[str] = None
    outbound_cost: Optional[float] = None  # leg-level cost (sum into `cost`)
    # flight - return
    return_airline: Optional[str] = None       # blank → same as `provider`
    return_confirmation: Optional[str] = None  # blank → same as `confirmation`
    return_flight_number: Optional[str] = None
    return_depart_airport: Optional[str] = None
    return_arrive_airport: Optional[str] = None
    return_depart_time: Optional[str] = None
    return_arrive_time: Optional[str] = None
    return_cost: Optional[float] = None

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
    check_in_time: Optional[str] = None
    check_out: Optional[str] = None
    check_out_time: Optional[str] = None
    cancel_by: Optional[str] = None
    pickup_at: Optional[str] = None
    pickup_location: Optional[str] = None
    dropoff_at: Optional[str] = None
    dropoff_location: Optional[str] = None
    flight_number: Optional[str] = None
    depart_airport: Optional[str] = None
    arrive_airport: Optional[str] = None
    depart_time: Optional[str] = None
    arrive_time: Optional[str] = None
    outbound_cost: Optional[float] = None
    return_airline: Optional[str] = None
    return_confirmation: Optional[str] = None
    return_flight_number: Optional[str] = None
    return_depart_airport: Optional[str] = None
    return_arrive_airport: Optional[str] = None
    return_depart_time: Optional[str] = None
    return_arrive_time: Optional[str] = None
    return_cost: Optional[float] = None


class BookingUpdate(BaseModel):
    provider: Optional[str] = None
    confirmation: Optional[str] = None
    cost: Optional[float] = None
    amount_paid: Optional[float] = None
    balance_due_date: Optional[str] = None
    notes: Optional[str] = None
    check_in: Optional[str] = None
    check_in_time: Optional[str] = None
    check_out: Optional[str] = None
    check_out_time: Optional[str] = None
    cancel_by: Optional[str] = None
    pickup_at: Optional[str] = None
    pickup_location: Optional[str] = None
    dropoff_at: Optional[str] = None
    dropoff_location: Optional[str] = None
    flight_number: Optional[str] = None
    depart_airport: Optional[str] = None
    arrive_airport: Optional[str] = None
    depart_time: Optional[str] = None
    arrive_time: Optional[str] = None
    outbound_cost: Optional[float] = None
    return_airline: Optional[str] = None
    return_confirmation: Optional[str] = None
    return_flight_number: Optional[str] = None
    return_depart_airport: Optional[str] = None
    return_arrive_airport: Optional[str] = None
    return_depart_time: Optional[str] = None
    return_arrive_time: Optional[str] = None
    return_cost: Optional[float] = None


# ============================================================
# Packing Lists (reusable templates + per-competition instances)
# ============================================================
class PackingItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str
    category: Optional[str] = "Other"
    order: int = 0


class PackingTemplate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    items: List[PackingItem] = Field(default_factory=list)
    tips: List[str] = Field(default_factory=list)
    is_default: bool = False  # true for the canonical CheerPlanner Standard seed
    created_at: str = Field(default_factory=utcnow_iso)


class PackingTemplateCreate(BaseModel):
    name: str
    items: List[PackingItem] = Field(default_factory=list)
    tips: List[str] = Field(default_factory=list)


class PackingTemplateUpdate(BaseModel):
    name: Optional[str] = None
    items: Optional[List[PackingItem]] = None
    tips: Optional[List[str]] = None


class PackingChecklistItem(BaseModel):
    """A single line on a per-competition packing list.

    `checked_by` maps athlete_id → bool so each athlete on a comp has their own
    check state for the same item (per-athlete sub-lists). A `null`-id key
    (`"shared"`) tracks the family-shared check when no athletes are scoped.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str
    category: Optional[str] = "Other"
    order: int = 0
    checked_by: Dict[str, bool] = Field(default_factory=dict)


class PackingList(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    competition_id: str
    template_id: Optional[str] = None
    name: Optional[str] = None
    items: List[PackingChecklistItem] = Field(default_factory=list)
    tips: List[str] = Field(default_factory=list)
    athlete_ids: List[str] = Field(default_factory=list)  # who this list covers
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


class PackingListCreate(BaseModel):
    competition_id: str
    template_id: Optional[str] = None
    name: Optional[str] = None
    items: Optional[List[PackingChecklistItem]] = None  # if None, copy from template
    tips: Optional[List[str]] = None
    athlete_ids: Optional[List[str]] = None


class PackingListUpdate(BaseModel):
    name: Optional[str] = None
    items: Optional[List[PackingChecklistItem]] = None
    tips: Optional[List[str]] = None
    athlete_ids: Optional[List[str]] = None
    save_as_template_name: Optional[str] = None  # if set, also save current items as a new template


# Canonical CheerPlanner Standard packing template (from user's spreadsheet).
CHEERPLANNER_STANDARD_PACKING: List[Dict[str, str]] = [
    # Uniform
    *[{"label": x, "category": "Uniform"} for x in [
        "Uniform Top", "Uniform Shorts", "Uniform Sports Bra", "Uniform Competition Bow",
        "Uniform Competition Socks", "Uniform Competition Cheer Shoes", "Uniform Team Shirt",
    ]],
    # Practice Wear
    *[{"label": x, "category": "Practice Wear"} for x in [
        "Team Coverup", "Team Sports Bra or Practice Top", "Practice Shorts", "Practice Bow",
    ]],
    # Hair & Makeup
    *[{"label": x, "category": "Hair & Makeup"} for x in [
        "Hairpiece (If Applicable)",
        "Hairpiece Sewing or Zip Tie Kit (Plastic Needle & Bright Colored Yarn, or Zip Ties)",
        "Scissors", "Brush", "Comb", "Gel", "Hairspray", "Hair Ties", "Hair Pins",
        "Barrel/Curling Iron (If Applicable)", "Flat Iron (If Applicable)",
        "Eyeshadow Palette", "Contour Palette", "Lipstick", "Lashes", "Lash Glue",
        "Foundation", "Primer", "Setting Spray", "Blush", "Mascara", "Team Glitter",
    ]],
    # Toiletries
    *[{"label": x, "category": "Toiletries"} for x in [
        "Toothbrush", "Toothpaste", "Toiletries (Soap, lotion, etc)",
    ]],
    # Essentials
    *[{"label": x, "category": "Essentials"} for x in [
        "Pajamas", "Undergarments", "Regular Clothes", "Regular Shoes",
        "Jacket", "Cell Phone", "Cell Phone Charger",
    ]],
    # Medication
    *[{"label": x, "category": "Medication"} for x in ["Medicines/Vitamins"]],
]

CHEERPLANNER_STANDARD_TIPS: List[str] = [
    "If flying — no uniform, cheer shoes, or cheer gear is allowed in checked baggage.",
    "Screenshot the itinerary and save to your phone — or upload it into CheerPlanner.",
    "Physically triple-check all uniform items — uniform top, shorts, mesh liner, socks (two pairs), shoes, bow, makeup, & hair products. Pack everything together and put it in the car first.",
    "Keep notifications turned on so you don't miss important team details or changes.",
    "Pack some healthy snacks and water for the hotel room.",
]



class Fundraiser(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    athlete_id: Optional[str] = None  # null = household-level
    name: str
    amount_raised: float = 0.0
    applied_amount: float = 0.0  # how much has been applied to expenses
    raised_on: str
    note: Optional[str] = None
    # Response-only convenience field
    available: float = 0.0
    created_at: str = Field(default_factory=utcnow_iso)


class FundraiserCreate(BaseModel):
    athlete_id: Optional[str] = None
    name: str
    amount_raised: float = 0.0
    raised_on: str
    note: Optional[str] = None


class FundraiserUpdate(BaseModel):
    athlete_id: Optional[str] = None
    name: Optional[str] = None
    amount_raised: Optional[float] = None
    raised_on: Optional[str] = None
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


class DeleteAccountPayload(BaseModel):
    password: str


@api_router.delete("/auth/me")
async def delete_account(payload: DeleteAccountPayload, current_user=Depends(get_current_user)):
    """Permanently delete the current user's account.

    Apple App Store Guideline 5.1.1(v): apps that support account creation
    must allow users to delete their account from within the app. We require
    password re-confirmation so a stolen/forgotten unlocked phone can't nuke
    the account, then cascade-delete every collection scoped to this user.

    Household behavior:
    • If the user is in a multi-member household, they're removed from the
      member list but shared records (athletes / expenses / etc. owned by
      OTHER household members) are preserved for the remaining members.
    • Records this user personally owns are deleted regardless.
    • If the user was the last member of a household, the household doc is
      also removed.
    """
    user_id = current_user["id"]
    user_doc = await db.users.find_one({"id": user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(payload.password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Password is incorrect")

    # Remove from any households first so we don't orphan refs.
    households = db.households.find({"member_user_ids": user_id})
    async for h in households:
        members = [m for m in (h.get("member_user_ids") or []) if m != user_id]
        if members:
            await db.households.update_one({"id": h["id"]}, {"$set": {"member_user_ids": members}})
        else:
            await db.households.delete_one({"id": h["id"]})

    # Cascade-delete every record this user personally created. (Records owned
    # by surviving household co-members are not touched.)
    collections_to_purge = [
        "athletes", "competitions", "bookings", "expenses", "payments",
        "fundraisers", "schedule_events", "packing_templates", "packing_lists",
    ]
    deleted_counts: Dict[str, int] = {}
    for name in collections_to_purge:
        res = await db[name].delete_many({"user_id": user_id})
        deleted_counts[name] = res.deleted_count

    # household_invites uses `invited_by` (not `user_id`) for ownership.
    invite_res = await db.household_invites.delete_many({"invited_by": user_id})
    deleted_counts["household_invites"] = invite_res.deleted_count

    # Finally, the user account itself.
    await db.users.delete_one({"id": user_id})

    return {
        "deleted": True,
        "user_id": user_id,
        "purged": deleted_counts,
    }


# ============================================================
# Athletes
# ============================================================
@api_router.get("/athletes", response_model=List[Athlete])
async def list_athletes(current_user=Depends(get_current_user)):
    docs = await db.athletes.find({"user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"_id": 0}).sort("created_at", 1).to_list(500)
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
    # Honor explicit nulls for nullable fields so users can clear them (e.g. remove avatar)
    nullable_fields = {"team", "gym", "avatar_image"}
    sent = payload.model_dump(exclude_unset=True)
    updates: dict = {}
    for k, v in sent.items():
        if v is None and k not in nullable_fields:
            continue
        updates[k] = v
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.athletes.update_one(
        {"id": athlete_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    doc = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    return Athlete(**doc)


@api_router.delete("/athletes/{athlete_id}")
async def delete_athlete(athlete_id: str, current_user=Depends(get_current_user)):
    res = await db.athletes.delete_one({"id": athlete_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    await db.expenses.delete_many({"athlete_id": athlete_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}})
    await db.payments.delete_many({"athlete_id": athlete_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}})
    return {"deleted": True}


# ============================================================
# Expenses
# ============================================================
@api_router.get("/expenses/categories")
async def expense_categories():
    return {"categories": EXPENSE_CATEGORIES}


async def _build_paid_map(user_id: str) -> dict:
    """Return {expense_id: paid_amount_sum} from all payments for this user."""
    paid_map: dict = {}
    async for p in db.payments.find(
        {"user_id": user_id},
        {"_id": 0, "amount": 1, "applied_expense_ids": 1, "allocations": 1},
    ).limit(20000):
        allocs = p.get("allocations") or []
        if allocs:
            # Precise per-expense breakdown (used by bulk auto-allocation)
            for a in allocs:
                eid = a.get("expense_id")
                amt = float(a.get("amount") or 0)
                if eid and amt:
                    paid_map[eid] = round(paid_map.get(eid, 0.0) + amt, 2)
            continue
        ids = p.get("applied_expense_ids") or []
        if not ids:
            continue
        share = float(p.get("amount") or 0) / len(ids)
        for eid in ids:
            paid_map[eid] = round(paid_map.get(eid, 0.0) + share, 2)
    return paid_map


def _expense_with_balance(doc: dict, paid_map: dict) -> ExpenseEntry:
    paid = float(paid_map.get(doc["id"], 0.0))
    amt = float(doc.get("amount") or 0.0)
    # If marked paid manually but no payments recorded, surface full amount as paid
    if doc.get("paid") and paid < amt:
        paid = amt
    balance = max(0.0, round(amt - paid, 2))
    doc = {**doc, "paid_amount": round(paid, 2), "balance_due": balance}
    return ExpenseEntry(**doc)


@api_router.get("/expenses", response_model=List[ExpenseEntry])
async def list_expenses(
    athlete_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    q = {"user_id": {"$in": await _household_user_ids(current_user["id"])}}
    if athlete_id:
        q["athlete_id"] = athlete_id
    docs = await db.expenses.find(q, {"_id": 0}).sort("incurred_on", -1).to_list(2000)
    paid_map = await _build_paid_map(current_user["id"])
    return [_expense_with_balance(d, paid_map) for d in docs]


@api_router.post("/expenses", response_model=List[ExpenseEntry])
async def create_expense(payload: ExpenseCreate, current_user=Depends(get_current_user)):
    from datetime import datetime as _dt, timedelta as _td
    data = payload.model_dump()
    # Strip response-only / non-stored fields
    for k in ("paid_amount", "balance_due", "recurrence", "recurrence_count"):
        data.pop(k, None)
    # Auto-populate due_date from incurred_on if not provided
    if not data.get("due_date"):
        data["due_date"] = data.get("incurred_on")

    recurrence = payload.recurrence
    count = max(1, int(payload.recurrence_count or 1)) if recurrence else 1
    group_id = str(uuid.uuid4()) if (recurrence and count > 1) else None

    created: List[ExpenseEntry] = []
    docs: List[dict] = []

    def _shift(date_str: str, n: int) -> Optional[str]:
        """Shift an ISO date string by n iterations of the recurrence."""
        if not date_str or not recurrence or n == 0:
            return date_str
        try:
            base = _dt.fromisoformat(date_str[:10]).date()
        except Exception:
            return date_str
        if recurrence == "monthly":
            # Add n months, clamping day to month length
            y, m = base.year, base.month + n
            y += (m - 1) // 12
            m = ((m - 1) % 12) + 1
            from calendar import monthrange
            d = min(base.day, monthrange(y, m)[1])
            return _dt(y, m, d).date().isoformat()
        if recurrence == "weekly":
            return (base + _td(days=7 * n)).isoformat()
        if recurrence == "biweekly":
            return (base + _td(days=14 * n)).isoformat()
        return date_str

    for i in range(count):
        entry = ExpenseEntry(
            user_id=current_user["id"],
            **{**data, "incurred_on": _shift(data["incurred_on"], i), "due_date": _shift(data.get("due_date"), i)},
            recurrence_group_id=group_id,
        )
        stored = entry.model_dump()
        stored.pop("paid_amount", None)
        stored.pop("balance_due", None)
        docs.append(stored)
        entry.balance_due = round(entry.amount - entry.paid_amount, 2)
        created.append(entry)
    if docs:
        await db.expenses.insert_many(docs)
    return created


class ExpenseBulkCreate(BaseModel):
    athlete_ids: List[str]
    category: str
    amount: float  # total (if equal) or per-athlete (if same)
    split_mode: Literal["equal", "same"] = "equal"
    incurred_on: str
    due_date: Optional[str] = None
    note: Optional[str] = None
    paid: bool = False


@api_router.post("/expenses/bulk", response_model=List[ExpenseEntry])
async def create_expenses_bulk(payload: ExpenseBulkCreate, current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    if not payload.athlete_ids:
        raise HTTPException(status_code=400, detail="Select at least one athlete")
    if payload.amount is None or payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    # Validate athletes belong to user
    valid_ids = {
        d["id"] async for d in db.athletes.find(
            {"id": {"$in": payload.athlete_ids}, "user_id": user_id}, {"_id": 0, "id": 1}
        )
    }
    missing = [aid for aid in payload.athlete_ids if aid not in valid_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"Athlete(s) not found: {missing}")
    per_amt = (
        round(payload.amount / len(payload.athlete_ids), 2)
        if payload.split_mode == "equal" else round(payload.amount, 2)
    )
    if per_amt <= 0:
        raise HTTPException(status_code=400, detail="Per-athlete amount must be greater than zero")
    # Auto-populate due_date from incurred_on if not provided
    due = payload.due_date or payload.incurred_on
    created: List[ExpenseEntry] = []
    docs: List[dict] = []
    for aid in payload.athlete_ids:
        entry = ExpenseEntry(
            user_id=user_id,
            athlete_id=aid,
            category=payload.category,
            amount=per_amt,
            note=payload.note,
            incurred_on=payload.incurred_on,
            due_date=due,
            paid=payload.paid,
        )
        stored = entry.model_dump()
        stored.pop("paid_amount", None)
        stored.pop("balance_due", None)
        docs.append(stored)
        entry.balance_due = round(entry.amount, 2)
        created.append(entry)
    if docs:
        await db.expenses.insert_many(docs)
    return created


@api_router.patch("/expenses/{expense_id}", response_model=ExpenseEntry)
async def update_expense(expense_id: str, payload: ExpenseUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.expenses.update_one(
        {"id": expense_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    doc = await db.expenses.find_one({"id": expense_id}, {"_id": 0})
    paid_map = await _build_paid_map(current_user["id"])
    return _expense_with_balance(doc, paid_map)


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current_user=Depends(get_current_user)):
    res = await db.expenses.delete_one({"id": expense_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"deleted": True}


class ApplyPaymentRequest(BaseModel):
    amount: float
    source_type: Literal["manual", "fundraiser"] = "manual"
    fundraiser_id: Optional[str] = None
    paid_on: Optional[str] = None
    note: Optional[str] = None
    method: Optional[str] = None


@api_router.post("/expenses/{expense_id}/apply-payment", response_model=ExpenseEntry)
async def apply_payment_to_expense(
    expense_id: str,
    payload: ApplyPaymentRequest,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    if payload.amount is None or payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    expense = await db.expenses.find_one({"id": expense_id, "user_id": user_id}, {"_id": 0})
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # Determine remaining balance for this expense
    paid_map = await _build_paid_map(user_id)
    current_paid = float(paid_map.get(expense_id, 0.0))
    remaining = max(0.0, float(expense.get("amount") or 0.0) - current_paid)
    if remaining <= 0 or expense.get("paid"):
        raise HTTPException(status_code=400, detail="Expense is already fully paid")

    apply_amt = round(min(payload.amount, remaining), 2)

    # Handle fundraiser source
    fundraiser_doc = None
    if payload.source_type == "fundraiser":
        if not payload.fundraiser_id:
            raise HTTPException(status_code=400, detail="fundraiser_id required for fundraiser source")
        fundraiser_doc = await db.fundraisers.find_one(
            {"id": payload.fundraiser_id, "user_id": user_id}, {"_id": 0}
        )
        if not fundraiser_doc:
            raise HTTPException(status_code=404, detail="Fundraiser not found")
        fund_raised = float(fundraiser_doc.get("amount_raised") or 0.0)
        fund_applied = float(fundraiser_doc.get("applied_amount") or 0.0)
        fund_available = round(fund_raised - fund_applied, 2)
        if fund_available <= 0:
            raise HTTPException(status_code=400, detail="Fundraiser has no available balance")
        # cap apply_amt to the smaller of remaining and fundraiser available
        apply_amt = round(min(apply_amt, fund_available), 2)
        await db.fundraisers.update_one(
            {"id": payload.fundraiser_id, "user_id": user_id},
            {"$inc": {"applied_amount": apply_amt}},
        )

    method = payload.method or ("Fundraiser" if payload.source_type == "fundraiser" else None)
    note_parts: List[str] = []
    if fundraiser_doc:
        note_parts.append(f"From fundraiser: {fundraiser_doc.get('name', '')}")
    if payload.note:
        note_parts.append(payload.note)
    note = " — ".join([p for p in note_parts if p]) or None

    # Create a Payment record linked to this expense
    payment = PaymentEntry(
        user_id=user_id,
        athlete_id=expense["athlete_id"],
        amount=apply_amt,
        paid_on=payload.paid_on or date.today().isoformat(),
        method=method,
        note=note,
        applied_expense_ids=[expense_id],
        allocations=[PaymentAllocation(expense_id=expense_id, amount=apply_amt)],
    )
    await db.payments.insert_one(payment.model_dump())

    # If fully covered, flip expense.paid
    new_paid_total = round(current_paid + apply_amt, 2)
    fully_paid = new_paid_total >= float(expense.get("amount") or 0.0) - 1e-6
    if fully_paid and not expense.get("paid"):
        await db.expenses.update_one(
            {"id": expense_id, "user_id": user_id}, {"$set": {"paid": True}}
        )
        expense["paid"] = True

    # Refresh paid map and return updated expense
    paid_map = await _build_paid_map(user_id)
    return _expense_with_balance(expense, paid_map)


# ============================================================
# Payments
# ============================================================
@api_router.get("/payments", response_model=List[PaymentEntry])
async def list_payments(athlete_id: Optional[str] = None, current_user=Depends(get_current_user)):
    q = {"user_id": {"$in": await _household_user_ids(current_user["id"])}}
    if athlete_id:
        q["athlete_id"] = athlete_id
    docs = await db.payments.find(q, {"_id": 0}).sort("paid_on", -1).to_list(2000)
    return [PaymentEntry(**d) for d in docs]


@api_router.post("/payments", response_model=PaymentEntry)
async def create_payment(payload: PaymentCreate, current_user=Depends(get_current_user)):
    entry = PaymentEntry(user_id=current_user["id"], **payload.model_dump())
    await db.payments.insert_one(entry.model_dump())
    # Auto-mark linked expenses as paid ONLY if fully covered after this payment
    if entry.applied_expense_ids:
        paid_map = await _build_paid_map(current_user["id"])
        for eid in entry.applied_expense_ids:
            exp = await db.expenses.find_one(
                {"id": eid, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"_id": 0, "amount": 1, "paid": 1}
            )
            if not exp or exp.get("paid"):
                continue
            amt = float(exp.get("amount") or 0.0)
            paid = float(paid_map.get(eid, 0.0))
            if paid + 1e-6 >= amt:
                await db.expenses.update_one(
                    {"id": eid, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": {"paid": True}}
                )
    return entry


class PaymentBulkCreate(BaseModel):
    athlete_ids: List[str]
    amount: float  # total (if equal) or per-athlete (if same)
    split_mode: Literal["equal", "same"] = "equal"
    paid_on: str
    method: Optional[str] = None
    note: Optional[str] = None


@api_router.post("/payments/bulk", response_model=List[PaymentEntry])
async def create_payments_bulk(payload: PaymentBulkCreate, current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    if not payload.athlete_ids:
        raise HTTPException(status_code=400, detail="Select at least one athlete")
    if payload.amount is None or payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    valid_ids = {
        d["id"] async for d in db.athletes.find(
            {"id": {"$in": payload.athlete_ids}, "user_id": user_id}, {"_id": 0, "id": 1}
        )
    }
    missing = [aid for aid in payload.athlete_ids if aid not in valid_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"Athlete(s) not found: {missing}")
    per_amt = (
        round(payload.amount / len(payload.athlete_ids), 2)
        if payload.split_mode == "equal" else round(payload.amount, 2)
    )
    if per_amt <= 0:
        raise HTTPException(status_code=400, detail="Per-athlete amount must be greater than zero")

    # Per the latest UX: bulk payments are NOT auto-allocated to expenses.
    # Users must explicitly pick which expenses each payment covers (either by
    # checking expense boxes in the New Payment form, or by tapping "Apply" on
    # an expense later). This avoids surprising the user when an old expense
    # gets silently marked as paid.
    created: List[PaymentEntry] = []
    docs: List[dict] = []
    for aid in payload.athlete_ids:
        entry = PaymentEntry(
            user_id=user_id,
            athlete_id=aid,
            amount=per_amt,
            paid_on=payload.paid_on,
            method=payload.method,
            note=payload.note,
            applied_expense_ids=[],
            allocations=None,
        )
        docs.append(entry.model_dump())
        created.append(entry)
    if docs:
        await db.payments.insert_many(docs)
    return created


# ============================================================
# Apply available payment funds to a single expense
# ============================================================
@api_router.post("/expenses/{expense_id}/apply-available-payments")
async def apply_available_payments(expense_id: str, current_user=Depends(get_current_user)):
    """Pull leftover funds from this athlete's existing payments and apply
    them to the given expense.

    Walks payments oldest-first; for each payment, computes the un-allocated
    balance (= payment.amount minus the sum of its existing allocations) and
    consumes as much as needed to cover the expense's remaining balance.

    Updates each payment's `applied_expense_ids` + `allocations` in-place,
    so the funds are reserved (the same dollar can't be applied twice).
    """
    member_ids = await _household_user_ids(current_user["id"])
    exp = await db.expenses.find_one(
        {"id": expense_id, "user_id": {"$in": member_ids}}, {"_id": 0},
    )
    if not exp:
        raise HTTPException(status_code=404, detail="Expense not found")

    amt = float(exp.get("amount") or 0)
    # Short-circuit: if the user has already manually flipped the expense to paid
    # (PATCH paid=true without recording a payment) there's nothing to allocate.
    if exp.get("paid"):
        return {"applied": 0.0, "balance_due": 0.0, "payments_touched": 0}

    paid_map = await _build_paid_map(current_user["id"])
    balance_due = round(max(0.0, amt - float(paid_map.get(expense_id, 0.0))), 2)
    if balance_due <= 0:
        return {"applied": 0.0, "balance_due": 0.0, "payments_touched": 0}

    athlete_id = exp.get("athlete_id")
    if not athlete_id:
        raise HTTPException(status_code=400, detail="Expense has no athlete")

    # Find athlete's payments oldest first; calculate each one's remaining funds.
    remaining = balance_due
    applied_total = 0.0
    touched = 0
    async for p in db.payments.find(
        {"user_id": {"$in": member_ids}, "athlete_id": athlete_id},
        {"_id": 0},
    ).sort([("paid_on", 1), ("created_at", 1)]):
        if remaining <= 0:
            break
        p_amt = float(p.get("amount") or 0)
        allocations = list(p.get("allocations") or [])
        if allocations:
            used = sum(float(a.get("amount") or 0) for a in allocations)
        elif p.get("applied_expense_ids"):
            # Legacy / single-POST payment: the whole amount was implicitly
            # consumed by the explicitly-listed expense(s). Treat it as fully
            # allocated so we don't double-spend.
            used = p_amt
        else:
            used = 0.0
        free = round(p_amt - used, 2)
        if free <= 0:
            continue
        # Avoid double-applying to the same expense.
        already_for_this_exp = sum(
            float(a.get("amount") or 0) for a in allocations
            if a.get("expense_id") == expense_id
        )
        if already_for_this_exp >= amt - 1e-6:
            continue
        take = round(min(free, remaining), 2)
        if take <= 0:
            continue
        allocations.append({"expense_id": expense_id, "amount": take})
        applied_ids = list(set((p.get("applied_expense_ids") or []) + [expense_id]))
        await db.payments.update_one(
            {"id": p["id"]},
            {"$set": {"allocations": allocations, "applied_expense_ids": applied_ids}},
        )
        applied_total = round(applied_total + take, 2)
        remaining = round(remaining - take, 2)
        touched += 1

    # If fully covered, flip the expense as paid.
    new_paid_total = round(float(paid_map.get(expense_id, 0.0)) + applied_total, 2)
    if new_paid_total + 1e-6 >= amt and not exp.get("paid"):
        await db.expenses.update_one(
            {"id": expense_id, "user_id": {"$in": member_ids}}, {"$set": {"paid": True}},
        )

    return {
        "applied": applied_total,
        "balance_due": max(0.0, round(amt - new_paid_total, 2)),
        "payments_touched": touched,
    }


@api_router.patch("/payments/{payment_id}", response_model=PaymentEntry)
async def update_payment(payment_id: str, payload: PaymentUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.payments.update_one(
        {"id": payment_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Payment not found")
    doc = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    return PaymentEntry(**doc)


@api_router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, current_user=Depends(get_current_user)):
    res = await db.payments.delete_one({"id": payment_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"deleted": True}


# ============================================================
# Competitions
# ============================================================
@api_router.get("/competitions", response_model=List[Competition])
async def list_competitions(current_user=Depends(get_current_user)):
    docs = await db.competitions.find({"user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"_id": 0}).sort("event_date", 1).to_list(500)
    return [Competition(**d) for d in docs]


@api_router.post("/competitions", response_model=Competition)
async def create_competition(payload: CompetitionCreate, current_user=Depends(get_current_user)):
    comp = Competition(user_id=current_user["id"], **payload.model_dump())
    await db.competitions.insert_one(comp.model_dump())
    return comp


@api_router.get("/competitions/{competition_id}", response_model=Competition)
async def get_competition(competition_id: str, current_user=Depends(get_current_user)):
    doc = await db.competitions.find_one(
        {"id": competition_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"_id": 0}
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
        {"id": competition_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Competition not found")
    doc = await db.competitions.find_one({"id": competition_id}, {"_id": 0})
    return Competition(**doc)


@api_router.delete("/competitions/{competition_id}")
async def delete_competition(competition_id: str, current_user=Depends(get_current_user)):
    res = await db.competitions.delete_one(
        {"id": competition_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Competition not found")
    await db.bookings.delete_many({"competition_id": competition_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}})
    return {"deleted": True}


# ============================================================
# Bookings
# ============================================================
@api_router.get("/bookings", response_model=List[Booking])
async def list_bookings(
    competition_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    q = {"user_id": {"$in": await _household_user_ids(current_user["id"])}}
    if competition_id:
        q["competition_id"] = competition_id
    docs = await db.bookings.find(q, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [Booking(**d) for d in docs]


@api_router.post("/bookings", response_model=Booking)
async def create_booking(payload: BookingCreate, current_user=Depends(get_current_user)):
    if payload.type not in ("hotel", "car", "flight"):
        raise HTTPException(status_code=400, detail="Invalid booking type")
    data = payload.model_dump()
    # For flights: if leg-level costs are provided and the total `cost` is missing/zero,
    # derive the total automatically so balance-due calculations stay accurate.
    if payload.type == "flight":
        ob = data.get("outbound_cost") or 0
        rt = data.get("return_cost") or 0
        leg_total = float(ob) + float(rt)
        if leg_total > 0 and (not data.get("cost")):
            data["cost"] = leg_total
    booking = Booking(user_id=current_user["id"], **data)
    await db.bookings.insert_one(booking.model_dump())
    return booking


@api_router.patch("/bookings/{booking_id}", response_model=Booking)
async def update_booking(booking_id: str, payload: BookingUpdate, current_user=Depends(get_current_user)):
    sent = payload.model_dump(exclude_unset=True)
    nullable = {
        "provider", "confirmation", "balance_due_date", "notes",
        "check_in", "check_in_time", "check_out", "check_out_time", "cancel_by",
        "pickup_at", "pickup_location", "dropoff_at", "dropoff_location",
        "flight_number", "depart_airport", "arrive_airport", "depart_time", "arrive_time",
        "return_airline", "return_confirmation", "return_flight_number",
        "return_depart_airport", "return_arrive_airport", "return_depart_time", "return_arrive_time",
        "outbound_cost", "return_cost",
    }
    updates = {k: v for k, v in sent.items() if v is not None or k in nullable}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    # For flights: if leg-level costs are being updated, keep `cost` in sync (unless caller
    # explicitly sent their own `cost`).
    if ("outbound_cost" in updates or "return_cost" in updates) and "cost" not in updates:
        existing = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if existing and existing.get("type") == "flight":
            ob = updates.get("outbound_cost", existing.get("outbound_cost")) or 0
            rt = updates.get("return_cost", existing.get("return_cost")) or 0
            leg_total = float(ob) + float(rt)
            if leg_total > 0:
                updates["cost"] = leg_total
    res = await db.bookings.update_one(
        {"id": booking_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    doc = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    return Booking(**doc)


@api_router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, current_user=Depends(get_current_user)):
    res = await db.bookings.delete_one({"id": booking_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"deleted": True}


# ============================================================
# Calendar (aggregated)
# ============================================================
@api_router.get("/calendar")
async def calendar_feed(
    start: Optional[str] = None,
    end: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    """Return all dated events for the user in [start, end] (ISO YYYY-MM-DD).
    Items: due dates (expense), competitions, hotel check-in/out, flight depart/arrive, fundraisers.
    Each item: { id, kind, date, title, subtitle?, amount?, color, athlete_id?, link }
    """
    user_id = current_user["id"]

    def _normalize_date(value: Optional[str]) -> Optional[str]:
        """Normalize a date string into ISO YYYY-MM-DD.
        Accepts: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM[:SS]', 'DD-MM-YYYY [HH:MM]', 'DD/MM/YYYY'.
        Returns None if unparseable.
        """
        if not value:
            return None
        v = str(value).strip()
        if not v:
            return None
        # Already ISO?
        first10 = v[:10]
        if len(first10) == 10 and first10[4] == "-" and first10[7] == "-":
            # YYYY-MM-DD
            try:
                from datetime import date as _date
                _date.fromisoformat(first10)
                return first10
            except Exception:
                pass
        # DD-MM-YYYY or DD/MM/YYYY (with optional time)
        head = v.split(" ")[0].replace("/", "-")
        parts = head.split("-")
        if len(parts) == 3:
            a, b, c = parts
            try:
                if len(c) == 4 and len(a) <= 2 and len(b) <= 2:
                    # DD-MM-YYYY
                    return f"{int(c):04d}-{int(b):02d}-{int(a):02d}"
                if len(a) == 4 and len(b) <= 2 and len(c) <= 2:
                    # YYYY-MM-DD (already, but with single digits)
                    return f"{int(a):04d}-{int(b):02d}-{int(c):02d}"
            except Exception:
                return None
        return None

    def in_range(d: Optional[str]) -> bool:
        if not d:
            return False
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    def iter_days(start_date: Optional[str], end_date: Optional[str]):
        """Yield ISO date strings from start_date to end_date inclusive."""
        from datetime import datetime, timedelta
        if not start_date:
            return
        try:
            d1 = datetime.fromisoformat(_normalize_date(start_date)).date()
        except Exception:
            return
        try:
            d2 = datetime.fromisoformat(_normalize_date(end_date or start_date)).date()
        except Exception:
            d2 = d1
        if d2 < d1:
            d1, d2 = d2, d1
        delta = (d2 - d1).days
        for offset in range(delta + 1):
            yield (d1 + timedelta(days=offset)).isoformat(), offset, delta

    items: List[dict] = []

    # Athletes map for names
    athletes = {a["id"]: a async for a in db.athletes.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1, "avatar_color": 1})}

    # Expenses — emit due-date (or fall back to incurred_on if due_date is missing)
    paid_map = await _build_paid_map(user_id)
    async for e in db.expenses.find({"user_id": user_id}, {"_id": 0}):
        ath = athletes.get(e.get("athlete_id"), {})
        amt = float(e.get("amount") or 0)
        paid = float(paid_map.get(e.get("id"), 0.0))
        bal = max(0.0, round(amt - paid, 2))
        # Skip fully paid items
        if e.get("paid") or bal <= 0.001:
            continue
        # Fall back to incurred_on so legacy expenses without due_date still appear
        raw = e.get("due_date") or e.get("incurred_on")
        day = _normalize_date(raw)
        if not day or not in_range(day):
            continue
        items.append({
            "id": f"expense-due-{e['id']}",
            "kind": "expense_due",
            "date": day,
            "title": f"{e.get('category', 'Expense')} due",
            "subtitle": ath.get("name", ""),
            "amount": bal,
            "color": "#E11D48",  # red
            "athlete_id": e.get("athlete_id"),
            "link": f"/expenses/new?id={e['id']}",
        })
    # Competitions — span every day from event_date to end_date inclusive
    async for c in db.competitions.find({"user_id": user_id}, {"_id": 0}):
        ev = c.get("event_date")
        end_d = c.get("end_date") or ev
        if not ev:
            continue
        for day, offset, delta in iter_days(ev, end_d):
            if not in_range(day):
                continue
            if delta == 0:
                title = c.get("name", "Competition")
            elif offset == 0:
                title = f"{c.get('name', 'Competition')} starts"
            elif offset == delta:
                title = f"{c.get('name', 'Competition')} ends"
            else:
                title = f"{c.get('name', 'Competition')} (day {offset + 1} of {delta + 1})"
            items.append({
                "id": f"comp-{c['id']}-{day}",
                "kind": "competition",
                "date": day,
                "title": title,
                "time": c.get("event_time") if day == ev else None,
                "subtitle": (
                    f"{_fmt_time_12h(c.get('event_time'))}" + (f" \u00b7 {c.get('location')}" if c.get("location") else "")
                    if c.get("event_time") and day == ev
                    else c.get("location") or ""
                ),
                "color": "#007CFF",
                "link": f"/competitions/{c['id']}",
            })

    # Bookings — hotels, flights, ground
    async for b in db.bookings.find({"user_id": user_id}, {"_id": 0}):
        btype = b.get("type", "booking")
        comp_link = f"/competitions/{b.get('competition_id')}" if b.get("competition_id") else "/"
        vendor = b.get("provider") or btype.capitalize()
        conf = b.get("confirmation") or ""
        if btype == "hotel":
            ci, co = _normalize_date(b.get("check_in")), _normalize_date(b.get("check_out"))
            if ci:
                for day, offset, delta in iter_days(ci, co or ci):
                    if not in_range(day):
                        continue
                    if delta == 0:
                        title = f"Hotel: {vendor}"
                        kind = "hotel_checkin"
                    elif offset == 0:
                        title = f"Check-in: {vendor}"
                        kind = "hotel_checkin"
                    elif offset == delta:
                        title = f"Check-out: {vendor}"
                        kind = "hotel_checkout"
                    else:
                        title = f"Stay: {vendor} (night {offset + 1} of {delta + 1})"
                        kind = "hotel_stay"
                    # Add 12-hour times to check-in/out subtitles when set.
                    sub_parts = []
                    item_time: Optional[str] = None
                    if kind == "hotel_checkin" and b.get("check_in_time"):
                        sub_parts.append(f"Check-in {_fmt_time_12h(b.get('check_in_time'))}")
                        item_time = b.get("check_in_time")
                    elif kind == "hotel_checkout" and b.get("check_out_time"):
                        sub_parts.append(f"Check-out {_fmt_time_12h(b.get('check_out_time'))}")
                        item_time = b.get("check_out_time")
                    if conf:
                        sub_parts.append(conf)
                    items.append({
                        "id": f"hotel-{b['id']}-{day}",
                        "kind": kind,
                        "date": day,
                        "title": title,
                        "time": item_time,
                        "subtitle": " \u00b7 ".join(sub_parts) if sub_parts else conf,
                        "color": "#7C3AED",
                        "link": comp_link,
                    })
        elif btype == "flight":
            dep = _normalize_date(b.get("depart_time"))
            ret = _normalize_date(b.get("return_depart_time"))
            # Surface the time component (when stored) for flight legs.
            dep_t = _fmt_time_12h(b.get("depart_time"))
            ret_t = _fmt_time_12h(b.get("return_depart_time"))
            # Outbound day
            if dep and in_range(dep):
                base_sub = f"{vendor} {b.get('flight_number') or ''}".strip()
                sub = f"Depart {dep_t} \u00b7 {base_sub}".strip(" \u00b7 ") if dep_t else base_sub
                items.append({
                    "id": f"flight-dep-{b['id']}",
                    "kind": "flight_depart",
                    "date": dep,
                    "title": f"Flight {b.get('depart_airport') or ''} → {b.get('arrive_airport') or ''}".strip(),
                    "time": _extract_hhmm(b.get("depart_time")),
                    "end_time": _extract_hhmm(b.get("arrive_time")),
                    "subtitle": sub,
                    "color": "#7C3AED",
                    "link": comp_link,
                })
            # Return day
            if ret and in_range(ret):
                base_sub = f"{b.get('return_airline') or vendor} {b.get('return_flight_number') or ''}".strip()
                sub = f"Depart {ret_t} \u00b7 {base_sub}".strip(" \u00b7 ") if ret_t else base_sub
                items.append({
                    "id": f"flight-ret-{b['id']}",
                    "kind": "flight_return",
                    "date": ret,
                    "title": f"Return {b.get('return_depart_airport') or ''} → {b.get('return_arrive_airport') or ''}".strip(),
                    "time": _extract_hhmm(b.get("return_depart_time")),
                    "end_time": _extract_hhmm(b.get("return_arrive_time")),
                    "subtitle": sub,
                    "color": "#7C3AED",
                    "link": comp_link,
                })
            # Travel-window dots for in-between days (only if both legs exist)
            if dep and ret:
                for day, offset, delta in iter_days(dep, ret):
                    if offset == 0 or offset == delta:
                        continue  # already emitted depart/return events above
                    if in_range(day):
                        items.append({
                            "id": f"flight-trip-{b['id']}-{day}",
                            "kind": "travel_day",
                            "date": day,
                            "title": "Travel day",
                            "subtitle": vendor,
                            "color": "#7C3AED",
                            "link": comp_link,
                        })
        else:  # ground / other
            d = b.get("check_in") or (b.get("depart_time") or "")[:10] or None
            if in_range(d):
                items.append({
                    "id": f"trans-{b['id']}",
                    "kind": "transport",
                    "date": d,
                    "title": vendor,
                    "subtitle": btype,
                    "color": "#7C3AED",
                    "link": comp_link,
                })

    # Fundraisers — raised_on
    member_ids = await _household_user_ids(user_id)
    async for f in db.fundraisers.find({"user_id": {"$in": member_ids}}, {"_id": 0}):
        if in_range(f.get("raised_on")):
            items.append({
                "id": f"fund-{f['id']}",
                "kind": "fundraiser",
                "date": f["raised_on"],
                "title": f.get("name", "Fundraiser"),
                "subtitle": "Raised",
                "amount": float(f.get("amount_raised") or 0.0),
                "color": "#16A34A",  # green
                "link": "/fundraisers",
            })

    # Schedule events
    async for s in db.schedule_events.find({"user_id": {"$in": member_ids}}, {"_id": 0}):
        day = _normalize_date(s.get("date"))
        if not day or not in_range(day):
            continue
        et = s.get("event_type", "practice")
        # Color by type
        colors_by_type = {
            "practice": "#EA580C",          # orange
            "team_bonding": "#0EA5E9",       # light blue
            "private_lesson": "#DB2777",     # pink
            "choreography": "#9333EA",       # violet
            "class": "#0891B2",              # cyan
            "other": "#64748B",              # slate
        }
        time_str = ""
        if s.get("start_time"):
            time_str = _fmt_time_12h(s["start_time"])
            if s.get("end_time"):
                time_str += f" – {_fmt_time_12h(s['end_time'])}"
        subtitle = " · ".join([x for x in [time_str, s.get("location") or ""] if x])
        items.append({
            "id": f"schedule-{s['id']}",
            "kind": "schedule",
            "date": day,
            "title": s.get("title", "Event"),
            "subtitle": subtitle,
            "color": colors_by_type.get(et, "#64748B"),
            "link": f"/schedule/new?id={s['id']}",
        })

    # Sort by date asc
    items.sort(key=lambda x: x["date"])
    return {"items": items}


# ============================================================
# Fundraisers
# ============================================================
def _fundraiser_with_available(d: dict) -> Fundraiser:
    raised = float(d.get("amount_raised") or 0.0)
    applied = float(d.get("applied_amount") or 0.0)
    d = {**d, "available": round(max(0.0, raised - applied), 2)}
    return Fundraiser(**d)


@api_router.get("/fundraisers", response_model=List[Fundraiser])
async def list_fundraisers(current_user=Depends(get_current_user)):
    docs = await db.fundraisers.find({"user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"_id": 0}).sort("raised_on", -1).to_list(1000)
    return [_fundraiser_with_available(d) for d in docs]


@api_router.post("/fundraisers", response_model=Fundraiser)
async def create_fundraiser(payload: FundraiserCreate, current_user=Depends(get_current_user)):
    data = payload.model_dump()
    for k in ("available",):
        data.pop(k, None)
    fr = Fundraiser(user_id=current_user["id"], **data)
    stored = fr.model_dump()
    stored.pop("available", None)
    await db.fundraisers.insert_one(stored)
    fr.available = round(max(0.0, fr.amount_raised - fr.applied_amount), 2)
    return fr


@api_router.patch("/fundraisers/{fundraiser_id}", response_model=Fundraiser)
async def update_fundraiser(fundraiser_id: str, payload: FundraiserUpdate, current_user=Depends(get_current_user)):
    nullable_fields = {"athlete_id", "note"}
    sent = payload.model_dump(exclude_unset=True)
    updates: dict = {}
    for k, v in sent.items():
        if v is None and k not in nullable_fields:
            continue
        updates[k] = v
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.fundraisers.update_one(
        {"id": fundraiser_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Fundraiser not found")
    doc = await db.fundraisers.find_one({"id": fundraiser_id}, {"_id": 0})
    return _fundraiser_with_available(doc)


@api_router.delete("/fundraisers/{fundraiser_id}")
async def delete_fundraiser(fundraiser_id: str, current_user=Depends(get_current_user)):
    res = await db.fundraisers.delete_one({"id": fundraiser_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}})
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
        {"user_id": {"$in": await _household_user_ids(current_user["id"])}, "due_date": {"$ne": None}, "paid": False}, {"_id": 0}
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
        {"user_id": {"$in": await _household_user_ids(current_user["id"])}, "balance_due_date": {"$ne": None}}, {"_id": 0}
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
        {"user_id": {"$in": await _household_user_ids(current_user["id"])}, "booking_release_at": {"$ne": None}}, {"_id": 0}
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
        {"user_id": {"$in": await _household_user_ids(current_user["id"])}, "cancel_by": {"$ne": None}, "type": "hotel"}, {"_id": 0}
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

    # Pack-for-comp reminders — fires within the next 7 days when the comp's
    # packing list has unchecked items (or doesn't exist yet).
    member_ids_for_packing = await _household_user_ids(current_user["id"])
    async for c in db.competitions.find(
        {"user_id": {"$in": member_ids_for_packing}}, {"_id": 0},
    ):
        ev = parse_date(c.get("event_date"))
        if not ev:
            continue
        delta = (ev - today).days
        if delta < 0 or delta > 7:
            continue
        pl = await db.packing_lists.find_one(
            {"competition_id": c["id"], "user_id": {"$in": member_ids_for_packing}}, {"_id": 0},
        )
        # Count any unchecked item across any tracked athlete (or the "shared" key).
        unchecked = 0
        total = 0
        if pl:
            for it in (pl.get("items") or []):
                cb = it.get("checked_by") or {}
                keys = list(cb.keys()) or ["shared"]
                for k in keys:
                    total += 1
                    if not cb.get(k):
                        unchecked += 1
        else:
            unchecked = 1  # nudge to create one
            total = 0
        if unchecked <= 0:
            continue
        items.append({
            "id": f"packing:{c['id']}",
            "kind": "packing",
            "title": f"Pack for {c.get('name', 'competition')}",
            "subtitle": (
                f"{unchecked} items left" if total > 0 else "Tap to create a packing list"
            ),
            "amount": None,
            "due_date": c.get("event_date"),
            "days_until": delta,
            "ref_id": c["id"],
            "competition_id": c["id"],
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

    # Unpaid expense balance — accounts for partial payments
    paid_map = await _build_paid_map(user_id)
    unpaid_expense_balance = 0.0
    async for d in db.expenses.find({"user_id": user_id}, {"_id": 0, "id": 1, "amount": 1, "paid": 1}).limit(20000):
        if d.get("paid"):
            continue
        amt = float(d.get("amount") or 0)
        paid = float(paid_map.get(d.get("id"), 0.0))
        remaining = max(0.0, amt - paid)
        unpaid_expense_balance += remaining

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
ALLOWED_IMPORT_KINDS = {"competitions", "travel", "expenses", "schedule"}


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
            existing = await db.competitions.find({"user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            return {"kind": kind, "rows": rows, "count": len(rows), "existing_competitions": existing}
        if kind == "expenses":
            data = import_helpers.parse_expenses(file.filename or "upload", content)
            existing_athletes = await db.athletes.find({"user_id": {"$in": await _household_user_ids(current_user["id"])}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            return {
                "kind": kind,
                "format": data["format"],
                "rows": data["rows"],
                "athlete_columns": data["athlete_columns"],
                "count": len(data["rows"]),
                "existing_athletes": existing_athletes,
            }
        if kind == "schedule":
            rows = import_helpers.parse_schedule(file.filename or "upload", content)
            existing_athletes = await db.athletes.find(
                {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(500)
            return {"kind": kind, "rows": rows, "count": len(rows), "existing_athletes": existing_athletes}
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
                    # car pickup/dropoff
                    pickup_at=b.get("pickup_at"),
                    pickup_location=b.get("pickup_location"),
                    dropoff_at=b.get("dropoff_at"),
                    dropoff_location=b.get("dropoff_location"),
                    # flight outbound
                    flight_number=b.get("flight_number"),
                    depart_airport=b.get("depart_airport"),
                    arrive_airport=b.get("arrive_airport"),
                    depart_time=b.get("depart_time"),
                    arrive_time=b.get("arrive_time"),
                    outbound_cost=b.get("outbound_cost"),
                    # flight return
                    return_airline=b.get("return_airline"),
                    return_confirmation=b.get("return_confirmation"),
                    return_flight_number=b.get("return_flight_number"),
                    return_depart_airport=b.get("return_depart_airport"),
                    return_arrive_airport=b.get("return_arrive_airport"),
                    return_depart_time=b.get("return_depart_time"),
                    return_arrive_time=b.get("return_arrive_time"),
                    return_cost=b.get("return_cost"),
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

    if payload.kind == "schedule":
        existing = await db.athletes.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        name_to_id = {a["name"].strip().lower(): a["id"] for a in existing}

        for row in payload.rows:
            title = (row.get("title") or "").strip()
            event_date = row.get("date")
            if not title or not event_date:
                skipped += 1
                continue

            # Resolve / auto-create athletes referenced by name.
            athlete_ids: List[str] = []
            for nm in (row.get("athlete_names") or []):
                key = str(nm).strip().lower()
                if not key:
                    continue
                aid = name_to_id.get(key)
                if not aid:
                    new_a = Athlete(user_id=user_id, name=str(nm).strip())
                    await db.athletes.insert_one(new_a.model_dump())
                    aid = new_a.id
                    name_to_id[key] = aid
                    warnings.append(f"Created athlete '{nm}' for schedule event.")
                athlete_ids.append(aid)

            base = {
                "user_id": user_id,
                "athlete_ids": athlete_ids,
                "event_type": row.get("event_type") or "practice",
                "title": title,
                "location": row.get("location"),
                "date": event_date,
                "start_time": row.get("start_time"),
                "end_time": row.get("end_time"),
                "notes": row.get("notes"),
            }

            rule = row.get("recurrence_rule")
            if rule:
                try:
                    rule_obj = RecurrenceRule(**rule)
                    dates = _expand_recurrence(event_date, rule_obj)
                    series_id = str(uuid.uuid4())
                    docs = []
                    for d in dates:
                        ev = ScheduleEvent(
                            **{**base, "date": d},
                            series_id=series_id,
                            recurrence_rule=rule_obj,
                        )
                        docs.append(ev.model_dump())
                    if docs:
                        await db.schedule_events.insert_many(docs)
                        created += len(docs)
                except Exception as ex:
                    warnings.append(f"Recurrence ignored for '{title}': {ex}")
                    ev = ScheduleEvent(**base)
                    await db.schedule_events.insert_one(ev.model_dump())
                    created += 1
            else:
                ev = ScheduleEvent(**base)
                await db.schedule_events.insert_one(ev.model_dump())
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


@app.on_event("startup")
async def startup_db_client():
    # One-time backfill: ensure expenses with missing/null due_date inherit incurred_on
    try:
        cursor = db.expenses.find(
            {"$or": [{"due_date": None}, {"due_date": ""}, {"due_date": {"$exists": False}}]},
            {"_id": 0, "id": 1, "incurred_on": 1},
        )
        backfilled = 0
        async for e in cursor:
            if e.get("incurred_on"):
                await db.expenses.update_one(
                    {"id": e["id"]}, {"$set": {"due_date": e["incurred_on"]}}
                )
                backfilled += 1
        if backfilled:
            logger.info(f"Startup backfill: due_date set on {backfilled} expense(s)")
    except Exception as exc:
        logger.warning(f"Startup backfill skipped: {exc}")


def _fmt_time_12h(value: Optional[str]) -> str:
    """Convert 24h 'HH:MM' (or a free-form datetime string containing HH:MM) to 12h 'h:MM AM/PM'."""
    if not value:
        return ""
    import re as _re
    m = _re.search(r"(\d{1,2}):(\d{2})", str(value))
    if not m:
        return str(value)
    h = int(m.group(1))
    mm = m.group(2)
    period = "PM" if h >= 12 else "AM"
    h12 = h % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{mm} {period}"


def _expand_recurrence(base_date: str, rule: "RecurrenceRule") -> List[str]:
    """Return a sorted, deduped list of ISO YYYY-MM-DD dates for a recurring series.

    Always includes base_date as the first occurrence. `until` is inclusive.
    """
    try:
        start = datetime.strptime(base_date, "%Y-%m-%d").date()
    except Exception:
        return [base_date]
    try:
        end = datetime.strptime(rule.until, "%Y-%m-%d").date()
    except Exception:
        return [base_date]
    if end < start:
        return [base_date]

    freq = (rule.frequency or "weekly").lower()
    dates: List[date] = []
    # Safety cap so a misconfigured rule cannot blow up the DB.
    MAX_OCC = 366

    if freq == "daily":
        cur = start
        while cur <= end and len(dates) < MAX_OCC:
            dates.append(cur)
            cur = cur + timedelta(days=1)

    elif freq in ("weekly", "biweekly"):
        # Python weekday: Mon=0..Sun=6 ; rule uses Sun=0..Sat=6 → convert.
        def _py_dow(rule_dow: int) -> int:
            return (rule_dow - 1) % 7  # Sun=0 → 6, Mon=1 → 0, …
        wanted = sorted({_py_dow(d) for d in (rule.days_of_week or [])}) or [start.weekday()]
        step_weeks = 2 if freq == "biweekly" else 1
        # Walk week by week from the week containing start (Monday-based).
        week_anchor = start - timedelta(days=start.weekday())
        while week_anchor <= end and len(dates) < MAX_OCC:
            for dow in wanted:
                d = week_anchor + timedelta(days=dow)
                if d < start or d > end:
                    continue
                dates.append(d)
            week_anchor = week_anchor + timedelta(weeks=step_weeks)

    elif freq == "monthly":
        # Same day-of-month each month.
        y, m, d_ = start.year, start.month, start.day
        while True:
            try:
                cur = date(y, m, d_)
            except ValueError:
                # Skip months that don't have this day (e.g., Feb 30).
                pass
            else:
                if cur > end:
                    break
                if cur >= start:
                    dates.append(cur)
            # next month
            m += 1
            if m > 12:
                m = 1
                y += 1
            if len(dates) >= MAX_OCC:
                break
    else:
        return [base_date]

    iso_set = sorted({d.isoformat() for d in dates})
    return iso_set or [base_date]


@api_router.get("/schedule", response_model=List[ScheduleEvent])
async def list_schedule(
    athlete_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    q = {"user_id": {"$in": await _household_user_ids(current_user["id"])}}
    if athlete_id:
        q["athlete_ids"] = athlete_id
    docs = await db.schedule_events.find(q, {"_id": 0}).sort("date", 1).to_list(5000)
    return [ScheduleEvent(**d) for d in docs]


@api_router.post("/schedule", response_model=List[ScheduleEvent])
async def create_schedule(payload: ScheduleEventCreate, current_user=Depends(get_current_user)):
    base = payload.model_dump()
    rule = base.pop("recurrence_rule", None)

    if rule:
        rule_obj = RecurrenceRule(**rule) if not isinstance(rule, RecurrenceRule) else rule
        dates = _expand_recurrence(base["date"], rule_obj)
        series_id = str(uuid.uuid4())
        entries = []
        for d in dates:
            ev = ScheduleEvent(
                user_id=current_user["id"],
                **{**base, "date": d},
                series_id=series_id,
                recurrence_rule=rule_obj,
            )
            entries.append(ev)
        if entries:
            await db.schedule_events.insert_many([e.model_dump() for e in entries])
        return entries

    entry = ScheduleEvent(user_id=current_user["id"], **base)
    await db.schedule_events.insert_one(entry.model_dump())
    return [entry]


@api_router.patch("/schedule/{event_id}")
async def update_schedule(
    event_id: str,
    payload: ScheduleEventUpdate,
    scope: str = "single",  # "single" | "series"
    current_user=Depends(get_current_user),
):
    sent = payload.model_dump(exclude_unset=True)
    nullable = {"location", "start_time", "end_time", "notes"}
    updates = {k: v for k, v in sent.items() if v is not None or k in nullable}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.schedule_events.find_one(
        {"id": event_id, "user_id": {"$in": member_ids}}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")

    if scope == "series" and existing.get("series_id"):
        # Don't propagate date across the series — date is per-instance.
        series_updates = {k: v for k, v in updates.items() if k != "date"}
        if series_updates:
            await db.schedule_events.update_many(
                {"series_id": existing["series_id"], "user_id": {"$in": member_ids}},
                {"$set": series_updates},
            )
        # If date was sent, still update just this instance.
        if "date" in updates:
            await db.schedule_events.update_one(
                {"id": event_id, "user_id": {"$in": member_ids}},
                {"$set": {"date": updates["date"]}},
            )
        docs = await db.schedule_events.find(
            {"series_id": existing["series_id"], "user_id": {"$in": member_ids}}, {"_id": 0}
        ).sort("date", 1).to_list(5000)
        return {"updated": len(docs), "scope": "series", "events": [ScheduleEvent(**d).model_dump() for d in docs]}

    await db.schedule_events.update_one(
        {"id": event_id, "user_id": {"$in": member_ids}},
        {"$set": updates},
    )
    doc = await db.schedule_events.find_one({"id": event_id}, {"_id": 0})
    return {"updated": 1, "scope": "single", "events": [ScheduleEvent(**doc).model_dump()]}


@api_router.delete("/schedule/{event_id}")
async def delete_schedule(
    event_id: str,
    scope: str = "single",  # "single" | "series"
    current_user=Depends(get_current_user),
):
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.schedule_events.find_one(
        {"id": event_id, "user_id": {"$in": member_ids}}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")

    if scope == "series" and existing.get("series_id"):
        res = await db.schedule_events.delete_many(
            {"series_id": existing["series_id"], "user_id": {"$in": member_ids}}
        )
        return {"deleted": res.deleted_count, "scope": "series"}

    await db.schedule_events.delete_one({"id": event_id, "user_id": {"$in": member_ids}})
    return {"deleted": 1, "scope": "single"}


# ============================================================
# Household — shared data between co-parents/guardians
# ============================================================
async def _get_or_create_household(user_id: str) -> dict:
    """Return the household this user belongs to. Lazy-creates a solo household for legacy users."""
    h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    if h:
        return h
    new_h = Household(member_user_ids=[user_id]).model_dump()
    await db.households.insert_one(dict(new_h))
    return new_h


async def _household_user_ids(user_id: str) -> List[str]:
    """Return all user_ids in the same household as the requester (including the requester)."""
    h = await _get_or_create_household(user_id)
    return h.get("member_user_ids", [user_id])


@api_router.get("/household")
async def get_household(current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    members = []
    async for u in db.users.find({"id": {"$in": h["member_user_ids"]}}, {"_id": 0, "id": 1, "email": 1, "name": 1}):
        members.append(u)
    return {"id": h["id"], "members": members}


@api_router.post("/household/invite")
async def create_household_invite(current_user=Depends(get_current_user)):
    h = await _get_or_create_household(current_user["id"])
    # Generate 6-char alphanumeric code
    import secrets
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no confusing 0/O/1/I
    code = "".join(secrets.choice(alphabet) for _ in range(6))
    from datetime import timedelta as _td, datetime as _dt
    expires = (_dt.utcnow() + _td(days=7)).isoformat() + "Z"
    invite = HouseholdInvite(
        household_id=h["id"],
        invited_by=current_user["id"],
        code=code,
        expires_at=expires,
    ).model_dump()
    await db.household_invites.insert_one(invite)
    return {"code": code, "expires_at": expires}


@api_router.post("/household/join")
async def join_household(payload: HouseholdJoinRequest, current_user=Depends(get_current_user)):
    code = payload.code.strip().upper()
    invite = await db.household_invites.find_one({"code": code, "used_at": None}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid or expired invite code")
    from datetime import datetime as _dt
    try:
        expires = _dt.fromisoformat(invite["expires_at"].replace("Z", ""))
        if expires < _dt.utcnow():
            raise HTTPException(status_code=400, detail="Invite code has expired")
    except (ValueError, KeyError):
        pass
    user_id = current_user["id"]
    if user_id == invite["invited_by"]:
        raise HTTPException(status_code=400, detail="You can't use your own invite code")
    # Remove user from current household (and delete household if empty)
    current_h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    if current_h and current_h["id"] != invite["household_id"]:
        new_members = [u for u in current_h["member_user_ids"] if u != user_id]
        if new_members:
            await db.households.update_one({"id": current_h["id"]}, {"$set": {"member_user_ids": new_members}})
        else:
            await db.households.delete_one({"id": current_h["id"]})
    # Add user to target household
    await db.households.update_one(
        {"id": invite["household_id"]},
        {"$addToSet": {"member_user_ids": user_id}},
    )
    # Mark invite as used
    await db.household_invites.update_one(
        {"id": invite["id"]}, {"$set": {"used_at": utcnow_iso()}}
    )
    return {"joined": True, "household_id": invite["household_id"]}


@api_router.post("/household/leave")
async def leave_household(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    h = await db.households.find_one({"member_user_ids": user_id}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="No household")
    remaining = [u for u in h["member_user_ids"] if u != user_id]
    if remaining:
        await db.households.update_one({"id": h["id"]}, {"$set": {"member_user_ids": remaining}})
    else:
        await db.households.delete_one({"id": h["id"]})
    # Create a new solo household for this user
    new_h = Household(member_user_ids=[user_id]).model_dump()
    await db.households.insert_one(new_h)
    return {"left": True, "new_household_id": new_h["id"]}


# ============================================================
# Export — CSV (expenses, payments) and ICS (calendar)
# ============================================================
from fastapi.responses import PlainTextResponse  # noqa: E402
import csv as _csv  # noqa: E402
import io as _io  # noqa: E402


@api_router.get("/export/expenses-payments.csv", response_class=PlainTextResponse)
async def export_expenses_payments_csv(current_user=Depends(get_current_user)):
    """One combined CSV containing both expenses and payments for the household.

    A `type` column distinguishes the row kind so users can sort/filter in Excel.
    """
    user_ids = await _household_user_ids(current_user["id"])
    ath_map = {
        a["id"]: a["name"]
        async for a in db.athletes.find({"user_id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1})
    }
    cat_map = {
        e["id"]: e.get("category", "")
        async for e in db.expenses.find({"user_id": {"$in": user_ids}}, {"_id": 0, "id": 1, "category": 1})
    }
    paid_map = await _build_paid_map(current_user["id"])

    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow([
        "Type", "Date", "Athlete", "Category", "Amount", "Paid Amount",
        "Balance Due", "Due Date", "Status", "Method", "Applied To", "Note", "ID",
    ])

    rows: List[List[str]] = []
    async for e in db.expenses.find({"user_id": {"$in": user_ids}}, {"_id": 0}).sort("incurred_on", -1):
        amt = float(e.get("amount") or 0)
        paid = float(paid_map.get(e["id"], 0.0))
        bal = max(0.0, round(amt - paid, 2))
        rows.append([
            "Expense",
            e.get("incurred_on", ""),
            ath_map.get(e.get("athlete_id"), ""),
            e.get("category", ""),
            f"{amt:.2f}",
            f"{paid:.2f}",
            f"{bal:.2f}",
            e.get("due_date") or "",
            "Paid" if e.get("paid") else ("Partial" if paid > 0 else "Unpaid"),
            "", "",  # method, applied_to (n/a for expenses)
            (e.get("note") or "").replace("\n", " "),
            e["id"],
        ])

    async for p in db.payments.find({"user_id": {"$in": user_ids}}, {"_id": 0}).sort("paid_on", -1):
        applied = ", ".join(
            cat_map.get(eid, "") for eid in (p.get("applied_expense_ids") or []) if cat_map.get(eid)
        )
        rows.append([
            "Payment",
            p.get("paid_on", ""),
            ath_map.get(p.get("athlete_id"), ""),
            "",  # category (n/a for payments)
            f"{float(p.get('amount') or 0):.2f}",
            "", "", "",  # paid amount / balance / due date n/a
            "",
            p.get("method") or "",
            applied,
            (p.get("note") or "").replace("\n", " "),
            p["id"],
        ])

    # Sort the combined list by date descending so newest is on top.
    rows.sort(key=lambda r: r[1] or "", reverse=True)
    for r in rows:
        w.writerow(r)

    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cheerplanner-expenses-payments.csv"},
    )


@api_router.get("/export/expenses.csv", response_class=PlainTextResponse)
async def export_expenses_csv(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    paid_map = await _build_paid_map(user_id)
    ath_map = {
        a["id"]: a["name"]
        async for a in db.athletes.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1})
    }
    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["id", "athlete", "category", "amount", "paid_amount", "balance_due", "incurred_on", "due_date", "paid", "note"])
    async for e in db.expenses.find({"user_id": user_id}, {"_id": 0}).sort("incurred_on", -1):
        amt = float(e.get("amount") or 0)
        paid = float(paid_map.get(e["id"], 0.0))
        bal = max(0.0, round(amt - paid, 2))
        w.writerow([
            e["id"], ath_map.get(e.get("athlete_id"), ""), e.get("category", ""),
            f"{amt:.2f}", f"{paid:.2f}", f"{bal:.2f}",
            e.get("incurred_on", ""), e.get("due_date") or "",
            "yes" if e.get("paid") else "no",
            (e.get("note") or "").replace("\n", " "),
        ])
    return PlainTextResponse(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=expenses.csv"})


@api_router.get("/export/payments.csv", response_class=PlainTextResponse)
async def export_payments_csv(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    ath_map = {
        a["id"]: a["name"]
        async for a in db.athletes.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1})
    }
    cat_map = {
        e["id"]: e.get("category", "")
        async for e in db.expenses.find({"user_id": user_id}, {"_id": 0, "id": 1, "category": 1})
    }
    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["id", "athlete", "amount", "paid_on", "method", "applied_to", "note"])
    async for p in db.payments.find({"user_id": user_id}, {"_id": 0}).sort("paid_on", -1):
        applied = ", ".join(cat_map.get(eid, "") for eid in (p.get("applied_expense_ids") or []) if cat_map.get(eid))
        w.writerow([
            p["id"], ath_map.get(p.get("athlete_id"), ""),
            f"{float(p.get('amount') or 0):.2f}",
            p.get("paid_on", ""), p.get("method") or "", applied,
            (p.get("note") or "").replace("\n", " "),
        ])
    return PlainTextResponse(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=payments.csv"})


def _extract_hhmm(value: Optional[str]) -> Optional[str]:
    """Pull 'HH:MM' (24h) from any string that contains it (e.g. '2025-11-13 08:30')."""
    if not value:
        return None
    import re as _re
    m = _re.search(r"(\d{1,2}):(\d{2})", str(value))
    if not m:
        return None
    try:
        h = int(m.group(1))
        if not (0 <= h <= 23):
            return None
    except ValueError:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


@api_router.get("/export/calendar.ics", response_class=PlainTextResponse)
async def export_calendar_ics(current_user=Depends(get_current_user)):
    # Reuse the calendar feed for a wide range (1 year back to 2 years forward)
    from datetime import date as _d, timedelta as _td
    today = _d.today()
    start = (today - _td(days=365)).isoformat()
    end = (today + _td(days=730)).isoformat()
    feed = await calendar_feed(start=start, end=end, current_user=current_user)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CheerPlanner//EN", "CALSCALE:GREGORIAN"]
    now = utcnow_iso().replace("-", "").replace(":", "").replace(".", "")[:15] + "Z"
    for item in feed.get("items", []):
        d = item["date"].replace("-", "")
        uid = f"{item['id']}@cheerplanner"
        summary = (item.get("title") or "Event").replace(",", "\\,").replace(";", "\\;")
        desc = (item.get("subtitle") or "").replace(",", "\\,").replace(";", "\\;")
        # If the item carries a HH:MM time, emit a timed VEVENT in floating local
        # time (no TZID) so Apple/Google calendars treat it as the user's local zone.
        t = item.get("time")
        end_t = item.get("end_time")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now}",
        ]
        if t:
            hh, mm = t.split(":")
            lines.append(f"DTSTART:{d}T{hh}{mm}00")
            # Default 1-hour duration when no explicit end is known.
            if end_t:
                eh, em = end_t.split(":")
                lines.append(f"DTEND:{d}T{eh}{em}00")
            else:
                # +1h fallback
                end_h = (int(hh) + 1) % 24
                lines.append(f"DTEND:{d}T{end_h:02d}{mm}00")
        else:
            lines.append(f"DTSTART;VALUE=DATE:{d}")
        lines.append(f"SUMMARY:{summary}")
        if desc:
            lines.append(f"DESCRIPTION:{desc}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return PlainTextResponse(content="\r\n".join(lines), media_type="text/calendar", headers={"Content-Disposition": "attachment; filename=cheerplanner.ics"})


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


# ============================================================
# Packing list endpoints
# ============================================================
def _hydrate_template_items(items: List[Dict[str, Any]]) -> List[PackingItem]:
    """Coerce raw item dicts to PackingItem models, assigning order if missing."""
    out: List[PackingItem] = []
    for i, raw in enumerate(items or []):
        it = raw if isinstance(raw, PackingItem) else PackingItem(**raw)
        if it.order == 0:
            it.order = i
        out.append(it)
    return out


def _checklist_from_template_items(items: List[PackingItem]) -> List[PackingChecklistItem]:
    return [
        PackingChecklistItem(label=i.label, category=i.category, order=i.order)
        for i in items
    ]


@api_router.get("/packing-templates", response_model=List[PackingTemplate])
async def list_packing_templates(current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    docs = await db.packing_templates.find(
        {"user_id": {"$in": member_ids}}, {"_id": 0},
    ).sort([("is_default", -1), ("created_at", -1)]).to_list(500)
    return [PackingTemplate(**d) for d in docs]


@api_router.post("/packing-templates/seed-default", response_model=PackingTemplate)
async def seed_default_packing_template(current_user=Depends(get_current_user)):
    """Create the canonical CheerPlanner Standard template for this household.

    Idempotent — returns the existing default if already seeded.
    """
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.packing_templates.find_one(
        {"user_id": {"$in": member_ids}, "is_default": True}, {"_id": 0},
    )
    if existing:
        return PackingTemplate(**existing)
    items = [
        PackingItem(label=spec["label"], category=spec["category"], order=i)
        for i, spec in enumerate(CHEERPLANNER_STANDARD_PACKING)
    ]
    tpl = PackingTemplate(
        user_id=current_user["id"],
        name="CheerPlanner Standard",
        items=items,
        tips=list(CHEERPLANNER_STANDARD_TIPS),
        is_default=True,
    )
    await db.packing_templates.insert_one(tpl.model_dump())
    return tpl


@api_router.post("/packing-templates", response_model=PackingTemplate)
async def create_packing_template(payload: PackingTemplateCreate, current_user=Depends(get_current_user)):
    tpl = PackingTemplate(
        user_id=current_user["id"],
        name=payload.name.strip() or "Untitled list",
        items=_hydrate_template_items([
            i.model_dump() if isinstance(i, PackingItem) else i for i in payload.items
        ]),
        tips=payload.tips or [],
    )
    await db.packing_templates.insert_one(tpl.model_dump())
    return tpl


@api_router.patch("/packing-templates/{template_id}", response_model=PackingTemplate)
async def update_packing_template(template_id: str, payload: PackingTemplateUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    updates: Dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip() or "Untitled list"
    if payload.items is not None:
        updates["items"] = [i.model_dump() for i in _hydrate_template_items([
            i.model_dump() if isinstance(i, PackingItem) else i for i in payload.items
        ])]
    if payload.tips is not None:
        updates["tips"] = payload.tips
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.packing_templates.update_one(
        {"id": template_id, "user_id": {"$in": member_ids}}, {"$set": updates},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    doc = await db.packing_templates.find_one({"id": template_id}, {"_id": 0})
    return PackingTemplate(**doc)


@api_router.delete("/packing-templates/{template_id}")
async def delete_packing_template(template_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.packing_templates.delete_one({"id": template_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True}


@api_router.get("/competitions/{competition_id}/packing-list", response_model=Optional[PackingList])
async def get_packing_list(competition_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.packing_lists.find_one(
        {"competition_id": competition_id, "user_id": {"$in": member_ids}}, {"_id": 0},
    )
    return PackingList(**doc) if doc else None


@api_router.post("/competitions/{competition_id}/packing-list", response_model=PackingList)
async def create_or_replace_packing_list(
    competition_id: str,
    payload: PackingListCreate,
    current_user=Depends(get_current_user),
):
    member_ids = await _household_user_ids(current_user["id"])
    items: List[PackingChecklistItem]
    tips: List[str] = list(payload.tips or [])
    name: Optional[str] = payload.name
    if payload.items is not None:
        items = [
            i if isinstance(i, PackingChecklistItem) else PackingChecklistItem(**i)
            for i in payload.items
        ]
    elif payload.template_id:
        tpl_doc = await db.packing_templates.find_one(
            {"id": payload.template_id, "user_id": {"$in": member_ids}}, {"_id": 0},
        )
        if not tpl_doc:
            raise HTTPException(status_code=404, detail="Template not found")
        tpl = PackingTemplate(**tpl_doc)
        items = _checklist_from_template_items(tpl.items)
        if not tips:
            tips = list(tpl.tips)
        if not name:
            name = tpl.name
    else:
        items = []

    pl = PackingList(
        user_id=current_user["id"],
        competition_id=competition_id,
        template_id=payload.template_id,
        name=name,
        items=items,
        tips=tips,
        athlete_ids=payload.athlete_ids or [],
        updated_at=utcnow_iso(),
    )
    # Upsert — one packing list per (household, competition).
    await db.packing_lists.delete_many(
        {"competition_id": competition_id, "user_id": {"$in": member_ids}},
    )
    await db.packing_lists.insert_one(pl.model_dump())
    return pl


@api_router.patch("/packing-lists/{list_id}", response_model=PackingList)
async def update_packing_list(list_id: str, payload: PackingListUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    existing = await db.packing_lists.find_one(
        {"id": list_id, "user_id": {"$in": member_ids}}, {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Packing list not found")

    updates: Dict[str, Any] = {"updated_at": utcnow_iso()}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.items is not None:
        updates["items"] = [
            (i if isinstance(i, PackingChecklistItem) else PackingChecklistItem(**i)).model_dump()
            for i in payload.items
        ]
    if payload.tips is not None:
        updates["tips"] = payload.tips
    if payload.athlete_ids is not None:
        updates["athlete_ids"] = payload.athlete_ids

    await db.packing_lists.update_one(
        {"id": list_id, "user_id": {"$in": member_ids}}, {"$set": updates},
    )

    # Optionally snapshot current items into a fresh template.
    if payload.save_as_template_name:
        current_items = updates.get("items") or existing.get("items") or []
        tpl = PackingTemplate(
            user_id=current_user["id"],
            name=payload.save_as_template_name.strip() or "Saved list",
            items=[
                PackingItem(label=i.get("label", ""), category=i.get("category"), order=i.get("order", 0))
                for i in current_items if i.get("label")
            ],
            tips=(updates.get("tips") if "tips" in updates else existing.get("tips")) or [],
        )
        await db.packing_templates.insert_one(tpl.model_dump())

    doc = await db.packing_lists.find_one({"id": list_id}, {"_id": 0})
    return PackingList(**doc)


@api_router.delete("/packing-lists/{list_id}")
async def delete_packing_list(list_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.packing_lists.delete_one({"id": list_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Packing list not found")
    return {"deleted": True}



# Re-include router AFTER all routes are registered (export endpoints added after first include_router)
app.include_router(api_router)
