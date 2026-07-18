import uuid
from datetime import datetime, timezone
from typing import List, Optional, Literal, Dict, Any

from pydantic import BaseModel, Field, EmailStr


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ExternalLink(BaseModel):
    """A user-added external link (label + URL) attached to events/competitions."""
    label: str = ""
    url: str


# ============================================================
# Auth / users
# ============================================================
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
    team_access: bool = False


class TeamAccessPayload(BaseModel):
    enabled: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class DeleteAccountPayload(BaseModel):
    password: str


# ============================================================
# Households
# ============================================================
class Household(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    member_user_ids: List[str] = Field(default_factory=list)
    # v1.0.8 theming — household-scoped so co-parents see the same theme.
    theme: Optional[Dict[str, Any]] = None
    # v2.3 custom types — household-wide, reusable in create forms.
    custom_expense_categories: List[str] = Field(default_factory=list)
    custom_event_types: List[Dict[str, Any]] = Field(default_factory=list)  # [{id, label, color}]
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


# ============================================================
# Schedule
# ============================================================
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
    address: Optional[str] = None  # NEW: full street address used by maps
    team_id: Optional[str] = None  # NEW: optional link to a Team (shows its logo)
    date: str  # ISO YYYY-MM-DD
    end_date: Optional[str] = None  # NEW: optional multi-day range end (inclusive)
    start_time: Optional[str] = None  # "18:00"
    end_time: Optional[str] = None
    notes: Optional[str] = None
    series_id: Optional[str] = None  # all events of a recurring series share this id
    recurrence_rule: Optional[RecurrenceRule] = None  # stored on every instance for convenience
    links: List[ExternalLink] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)


class ScheduleEventCreate(BaseModel):
    athlete_ids: List[str] = Field(default_factory=list)
    event_type: str = "practice"
    title: str
    location: Optional[str] = None
    address: Optional[str] = None
    team_id: Optional[str] = None
    date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    recurrence_rule: Optional[RecurrenceRule] = None
    end_date: Optional[str] = None
    links: List[ExternalLink] = Field(default_factory=list)


class ScheduleEventUpdate(BaseModel):
    athlete_ids: Optional[List[str]] = None
    event_type: Optional[str] = None
    title: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    team_id: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    end_date: Optional[str] = None
    links: Optional[List[ExternalLink]] = None


# ============================================================
# Athletes
# ============================================================
class Athlete(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    role: Literal["athlete", "coach", "team_rep", "staff"] = "athlete"
    team: Optional[str] = None  # legacy single-team text field (kept for backwards-compat)
    gym: Optional[str] = None
    avatar_color: Optional[str] = "#E11D48"
    avatar_image: Optional[str] = None  # base64 data URL (e.g. data:image/jpeg;base64,...)
    competition_ids: List[str] = Field(default_factory=list)
    team_ids: List[str] = Field(default_factory=list)  # NEW: structured team memberships
    created_at: str = Field(default_factory=utcnow_iso)


class AthleteCreate(BaseModel):
    name: str
    role: Optional[Literal["athlete", "coach", "team_rep", "staff"]] = "athlete"
    team: Optional[str] = None
    gym: Optional[str] = None
    avatar_color: Optional[str] = "#E11D48"
    avatar_image: Optional[str] = None
    competition_ids: Optional[List[str]] = None
    team_ids: Optional[List[str]] = None


class AthleteUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["athlete", "coach", "team_rep", "staff"]] = None
    team: Optional[str] = None
    gym: Optional[str] = None
    avatar_color: Optional[str] = None
    avatar_image: Optional[str] = None
    competition_ids: Optional[List[str]] = None
    team_ids: Optional[List[str]] = None


# ============================================================
# Expenses / Payments
# ============================================================
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


class ExpenseBulkCreate(BaseModel):
    athlete_ids: List[str]
    category: str
    amount: float  # total (if equal) or per-athlete (if same)
    split_mode: Literal["equal", "same"] = "equal"
    incurred_on: str
    due_date: Optional[str] = None
    note: Optional[str] = None
    paid: bool = False


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
    allocations: Optional[List[PaymentAllocation]] = None


class PaymentUpdate(BaseModel):
    amount: Optional[float] = None
    paid_on: Optional[str] = None
    method: Optional[str] = None
    note: Optional[str] = None
    applied_expense_ids: Optional[List[str]] = None
    allocations: Optional[List[PaymentAllocation]] = None


class PaymentBulkCreate(BaseModel):
    athlete_ids: List[str]
    amount: float  # total (if equal) or per-athlete (if same)
    split_mode: Literal["equal", "same"] = "equal"
    paid_on: str
    method: Optional[str] = None
    note: Optional[str] = None


class ApplyPaymentRequest(BaseModel):
    amount: float
    source_type: Literal["manual", "fundraiser"] = "manual"
    fundraiser_id: Optional[str] = None
    paid_on: Optional[str] = None
    note: Optional[str] = None
    method: Optional[str] = None


# ============================================================
# Teams
# ============================================================
class Team(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str  # creator (the household owner who created it)
    name: str
    color: Optional[str] = "#0EA5E9"  # default team color
    season: Optional[str] = None  # e.g. "2025-2026"
    logo_image: Optional[str] = None  # base64 data URL (data:image/jpeg;base64,...) - v1.0.8
    logo_shape: Optional[Literal["square", "circle"]] = "square"  # v1.0.8 crop preference
    created_at: str = Field(default_factory=utcnow_iso)


class TeamCreate(BaseModel):
    name: str
    color: Optional[str] = "#0EA5E9"
    season: Optional[str] = None
    logo_image: Optional[str] = None
    logo_shape: Optional[Literal["square", "circle"]] = "square"


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    season: Optional[str] = None
    logo_image: Optional[str] = None
    logo_shape: Optional[Literal["square", "circle"]] = None


class TeamMeetTime(BaseModel):
    team_id: str
    date: Optional[str] = None              # ISO YYYY-MM-DD
    meet_time: Optional[str] = None         # "HH:MM" 24h
    performance_time: Optional[str] = None  # "HH:MM" 24h
    performance_location: Optional[str] = None


class TeamToWatch(BaseModel):
    name: str
    date: Optional[str] = None  # ISO date
    location: Optional[str] = None
    performance_time: Optional[str] = None  # "HH:MM" 24h


# ============================================================
# Competitions
# ============================================================
class Competition(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    location: Optional[str] = None
    address: Optional[str] = None  # NEW: full street address for map lookup
    event_date: str  # ISO date
    event_time: Optional[str] = None  # "HH:MM" 24h
    end_date: Optional[str] = None
    housing_required: bool = False
    booking_link: Optional[str] = None
    booking_release_at: Optional[str] = None  # ISO datetime
    notes: Optional[str] = None
    team_ids: List[str] = Field(default_factory=list)
    team_meet_times: List[TeamMeetTime] = Field(default_factory=list)
    teams_to_watch: List[TeamToWatch] = Field(default_factory=list)
    links: List[ExternalLink] = Field(default_factory=list)
    # S1: minutes-before offsets for SMS reminders on the stay-to-play booking opening.
    sms_reminder_offsets: List[int] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)


class CompetitionCreate(BaseModel):
    name: str
    location: Optional[str] = None
    address: Optional[str] = None
    event_date: str
    event_time: Optional[str] = None
    end_date: Optional[str] = None
    housing_required: bool = False
    booking_link: Optional[str] = None
    booking_release_at: Optional[str] = None
    notes: Optional[str] = None
    team_ids: Optional[List[str]] = None
    team_meet_times: Optional[List[TeamMeetTime]] = None
    teams_to_watch: Optional[List[TeamToWatch]] = None
    links: Optional[List[ExternalLink]] = None
    sms_reminder_offsets: Optional[List[int]] = None


class CompetitionUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    event_date: Optional[str] = None
    event_time: Optional[str] = None
    end_date: Optional[str] = None
    housing_required: Optional[bool] = None
    booking_link: Optional[str] = None
    booking_release_at: Optional[str] = None
    notes: Optional[str] = None
    team_ids: Optional[List[str]] = None
    team_meet_times: Optional[List[TeamMeetTime]] = None
    teams_to_watch: Optional[List[TeamToWatch]] = None
    links: Optional[List[ExternalLink]] = None
    sms_reminder_offsets: Optional[List[int]] = None


# ============================================================
# Bookings (hotel / car / flight)
# ============================================================
BookingType = Literal["hotel", "car", "flight"]


class Booking(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    competition_id: str
    type: str  # hotel | car | flight
    # common
    provider: Optional[str] = None
    address: Optional[str] = None
    confirmation: Optional[str] = None
    cost: Optional[float] = 0.0
    amount_paid: Optional[float] = 0.0
    balance_due_date: Optional[str] = None
    notes: Optional[str] = None
    # hotel
    check_in: Optional[str] = None
    check_in_time: Optional[str] = None
    check_out: Optional[str] = None
    check_out_time: Optional[str] = None
    cancel_by: Optional[str] = None
    # car
    pickup_at: Optional[str] = None
    pickup_location: Optional[str] = None
    dropoff_at: Optional[str] = None
    dropoff_location: Optional[str] = None
    # flight outbound
    flight_number: Optional[str] = None
    depart_airport: Optional[str] = None
    arrive_airport: Optional[str] = None
    depart_time: Optional[str] = None
    arrive_time: Optional[str] = None
    outbound_cost: Optional[float] = None
    # flight return
    return_airline: Optional[str] = None
    return_confirmation: Optional[str] = None
    return_flight_number: Optional[str] = None
    return_depart_airport: Optional[str] = None
    return_arrive_airport: Optional[str] = None
    return_depart_time: Optional[str] = None
    return_arrive_time: Optional[str] = None
    return_cost: Optional[float] = None

    # S1: minutes-before offsets for SMS check-in reminders (fires relative to
    # the check-in-open time, which is 24h before each flight leg's departure).
    sms_reminder_offsets: List[int] = Field(default_factory=list)

    created_at: str = Field(default_factory=utcnow_iso)


class BookingCreate(BaseModel):
    competition_id: str
    type: str
    provider: Optional[str] = None
    address: Optional[str] = None
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
    sms_reminder_offsets: Optional[List[int]] = None


class BookingUpdate(BaseModel):
    provider: Optional[str] = None
    address: Optional[str] = None
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
    sms_reminder_offsets: Optional[List[int]] = None


# ============================================================
# Packing Lists
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
    is_default: bool = False
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
    athlete_ids: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


class PackingListCreate(BaseModel):
    competition_id: str
    template_id: Optional[str] = None
    name: Optional[str] = None
    items: Optional[List[PackingChecklistItem]] = None
    tips: Optional[List[str]] = None
    athlete_ids: Optional[List[str]] = None


class PackingListUpdate(BaseModel):
    name: Optional[str] = None
    items: Optional[List[PackingChecklistItem]] = None
    tips: Optional[List[str]] = None
    athlete_ids: Optional[List[str]] = None
    save_as_template_name: Optional[str] = None


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


# ============================================================
# Fundraisers
# ============================================================
class Fundraiser(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    athlete_id: Optional[str] = None  # null = household-level
    name: str
    amount_raised: float = 0.0
    applied_amount: float = 0.0  # how much has been applied to expenses
    raised_on: str
    note: Optional[str] = None
    goal_amount: Optional[float] = None
    link_url: Optional[str] = None
    is_public: bool = False
    share_token: Optional[str] = None
    # Response-only convenience field
    available: float = 0.0
    created_at: str = Field(default_factory=utcnow_iso)


class FundraiserCreate(BaseModel):
    athlete_id: Optional[str] = None
    name: str
    amount_raised: float = 0.0
    raised_on: str
    note: Optional[str] = None
    goal_amount: Optional[float] = None
    link_url: Optional[str] = None


class FundraiserUpdate(BaseModel):
    athlete_id: Optional[str] = None
    name: Optional[str] = None
    amount_raised: Optional[float] = None
    raised_on: Optional[str] = None
    note: Optional[str] = None
    goal_amount: Optional[float] = None
    link_url: Optional[str] = None


# ============================================================
# Imports
# ============================================================
ALLOWED_IMPORT_KINDS = {"competitions", "travel", "expenses", "schedule", "teams_to_watch"}


class ImportCommitPayload(BaseModel):
    kind: str
    rows: List[dict] = Field(default_factory=list)
    # for expenses wide-form: map of column-name -> athlete_id (existing) or "__new__:<NewName>"
    athlete_map: Optional[Dict[str, str]] = None
    # for travel: optional mapping competition-name -> competition_id
    competition_map: Optional[Dict[str, str]] = None
    # toggle: create competitions that are missing (travel)
    create_missing_competitions: bool = True


# ============================================================
# Bulk delete
# ============================================================
BULK_DELETE_COLLECTIONS = {
    "expenses": "expenses",
    "payments": "payments",
    "fundraisers": "fundraisers",
    "competitions": "competitions",
    "schedules": "schedule_events",
    "schedule_events": "schedule_events",
    "bookings": "bookings",
    "packing_templates": "packing_templates",
    "packing_lists": "packing_lists",
    "teams": "teams",
}


class BulkDeletePayload(BaseModel):
    resource: str
    ids: List[str]


# ============================================================
# Notification preferences (v1.0.7)
# ============================================================
NotificationFrequency = Literal["daily", "weekly", "off"]


class NotificationCategoryPrefs(BaseModel):
    """Per-category opt-in switches for reminder emails."""
    expense_due: bool = True
    booking_balance: bool = True
    booking_cancel_by: bool = True
    booking_release: bool = True
    competition_event: bool = True
    packing: bool = True


class NotificationPreferences(BaseModel):
    enabled: bool = True
    frequency: NotificationFrequency = "daily"
    categories: NotificationCategoryPrefs = Field(default_factory=NotificationCategoryPrefs)
    # IANA tz, e.g. "America/New_York". Used only by the digest scheduler.
    timezone: str = "America/New_York"
    # SMS reminders (Twilio) — explicit opt-in consent captured in-app
    sms_enabled: bool = False
    sms_phone: Optional[str] = None
    sms_consent_at: Optional[str] = None


class NotificationPreferencesUpdate(BaseModel):
    enabled: Optional[bool] = None
    frequency: Optional[NotificationFrequency] = None
    categories: Optional[NotificationCategoryPrefs] = None
    timezone: Optional[str] = None
    sms_enabled: Optional[bool] = None
    sms_phone: Optional[str] = None
    sms_consent_at: Optional[str] = None


# ============================================================
# Password reset (v1.0.7)
# ============================================================
class ForgotPasswordPayload(BaseModel):
    email: EmailStr


class ResetPasswordPayload(BaseModel):
    token: str
    new_password: str = Field(min_length=6)



# ============================================================
# Team Hub — Roster (Phase C)
# ============================================================
ROSTER_ROLES = ("athlete", "parent", "coach", "team_rep", "staff")


class RosterMember(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str  # creator (household-scoped visibility)
    name: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Literal["athlete", "parent", "coach", "team_rep", "staff"] = "parent"
    phone: Optional[str] = None
    email: Optional[str] = None
    parent_first_name: Optional[str] = None
    parent_last_name: Optional[str] = None
    parent_phone: Optional[str] = None
    parent_email: Optional[str] = None
    team_ids: List[str] = Field(default_factory=list)  # a person can be on multiple teams
    notes: Optional[str] = None
    source: Literal["manual", "athlete", "household"] = "manual"
    linked_id: Optional[str] = None  # source athlete id / household user id
    created_at: str = Field(default_factory=utcnow_iso)


class RosterMemberCreate(BaseModel):
    name: Optional[str] = None  # derived from first/last if omitted
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[Literal["athlete", "parent", "coach", "team_rep", "staff"]] = "parent"
    phone: Optional[str] = None
    email: Optional[str] = None
    parent_first_name: Optional[str] = None
    parent_last_name: Optional[str] = None
    parent_phone: Optional[str] = None
    parent_email: Optional[str] = None
    team_ids: Optional[List[str]] = None
    notes: Optional[str] = None


class RosterMemberUpdate(BaseModel):
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[Literal["athlete", "parent", "coach", "team_rep", "staff"]] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    parent_first_name: Optional[str] = None
    parent_last_name: Optional[str] = None
    parent_phone: Optional[str] = None
    parent_email: Optional[str] = None
    team_ids: Optional[List[str]] = None
    notes: Optional[str] = None


class RosterImportPayload(BaseModel):
    athlete_ids: List[str] = Field(default_factory=list)
    member_user_ids: List[str] = Field(default_factory=list)



# ============================================================
# Team Hub — Payment Tracking (Phase C, tracking-only)
# ============================================================
class TeamPaymentEntry(BaseModel):
    member_id: str
    paid: bool = False
    amount_paid: Optional[float] = None
    method: Optional[str] = None
    note: Optional[str] = None
    paid_at: Optional[str] = None


class PaymentTracker(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    amount: Optional[float] = None  # expected amount per person (optional)
    note: Optional[str] = None
    entries: List[TeamPaymentEntry] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)


class PaymentTrackerCreate(BaseModel):
    name: str
    amount: Optional[float] = None
    note: Optional[str] = None


class PaymentTrackerUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    note: Optional[str] = None


class PaymentEntryUpdate(BaseModel):
    paid: Optional[bool] = None
    amount_paid: Optional[float] = None
    method: Optional[str] = None
    note: Optional[str] = None
    paid_at: Optional[str] = None



# ============================================================
# Team Hub — Sizes (shared spreadsheet-style sheet over the roster)
# ============================================================
DEFAULT_SIZE_COLUMNS: List[str] = [
    "Shirt", "Tank", "Sports bra", "Shorts", "Shoes", "Sweatshirt", "Jacket", "Ring",
]


class SizeColumn(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str
    is_default: bool = False
    order: int = 0


class SizeSheet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    columns: List[SizeColumn] = Field(default_factory=list)
    values: Dict[str, Dict[str, str]] = Field(default_factory=dict)  # member_id -> {col_id: value}
    created_at: str = Field(default_factory=utcnow_iso)


class SizeColumnCreate(BaseModel):
    label: str


class SizeColumnUpdate(BaseModel):
    label: str


class SizeValueUpdate(BaseModel):
    member_id: str
    column_id: str
    value: str = ""


# ============================================================
# Team Hub — Paperwork / Other (multiple named sheets; checkbox + note per member)
# ============================================================
class PaperworkItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str
    order: int = 0


class PaperworkSheet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    items: List[PaperworkItem] = Field(default_factory=list)
    # member_id -> item_id -> {"done": bool, "note": Optional[str]}
    values: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utcnow_iso)


class PaperworkSheetCreate(BaseModel):
    name: str


class PaperworkSheetUpdate(BaseModel):
    name: str


class PaperworkItemCreate(BaseModel):
    label: str


class PaperworkItemUpdate(BaseModel):
    label: str


class PaperworkValueUpdate(BaseModel):
    member_id: str
    item_id: str
    done: Optional[bool] = None
    note: Optional[str] = None



# ============================================================
# Team Hub — Sign-Up Sheet (personnel create custom slots; people claim them)
# ============================================================
class SignupClaim(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    member_id: str
    qty: int = 1
    note: Optional[str] = None
    created_at: str = Field(default_factory=utcnow_iso)


class SignupSlot(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str
    qty_needed: int = 1
    order: int = 0
    claims: List[SignupClaim] = Field(default_factory=list)


class SignupSheet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    competition_id: Optional[str] = None
    slots: List[SignupSlot] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow_iso)


class SignupSheetCreate(BaseModel):
    name: str
    competition_id: Optional[str] = None


class SignupSheetUpdate(BaseModel):
    name: Optional[str] = None
    competition_id: Optional[str] = None


class SignupSlotCreate(BaseModel):
    label: str
    qty_needed: int = 1


class SignupSlotUpdate(BaseModel):
    label: Optional[str] = None
    qty_needed: Optional[int] = None


class SignupClaimCreate(BaseModel):
    member_id: str
    qty: int = 1
    note: Optional[str] = None

