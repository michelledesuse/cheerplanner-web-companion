"""Central plan configuration for CheerPlanner Free vs Premium.

Everything tier-related is config-driven so limits and pricing can change later
WITHOUT touching the entitlement/permission architecture. The feature-gating
layer only ever asks "is this household Premium?" (see core/entitlements.py).
"""
from typing import Dict, Any

# ------------------------------------------------------------------
# Household seat limits (requirement #3). Configurable — change these
# numbers to change the product; nothing else needs to change.
# ------------------------------------------------------------------
PLAN_LIMITS: Dict[str, Dict[str, int]] = {
    "free": {
        "household_members": 2,      # primary + 1 additional
        # Free Team Hub limits (requirement #5 / approved split)
        "team_hub_athletes": 36,      # roster athletes on Free
        "team_hub_personnel": 4,      # coaches/reps/staff on Free
        "team_hub_signup_sheets": 1,
        "team_hub_todo_lists": 1,
        "team_hub_attendance_sessions": 1,
        "team_hub_collaborators": 0,  # single manager on Free
    },
    "premium": {
        "household_members": 6,       # primary + up to 5 additional
        "team_hub_athletes": -1,      # -1 = unlimited
        "team_hub_personnel": -1,
        "team_hub_signup_sheets": -1,
        "team_hub_todo_lists": -1,
        "team_hub_attendance_sessions": -1,
        "team_hub_collaborators": -1,
    },
}

# Premium-only Team Hub capabilities (feature flags, not counts).
# Free users can SEE these (locked previews) but not use them.
PREMIUM_TEAM_HUB_FEATURES = {
    "sizes",              # uniform/apparel size tracking
    "paperwork",          # paperwork tracking
    "team_payments",      # team payment tracking
    "roster_custom_columns",
    "roster_expanded_fields",   # allergies/medical/host-bonding/preferred name
    "spreadsheet_import",
    "spreadsheet_export",
    "parent_share_links",
    "mass_sms_reminders",
}

# ------------------------------------------------------------------
# Pricing DISPLAY metadata (requirement #6). The store (Apple/RevenueCat)
# is always the source of truth for real prices; this is only for UI copy
# and is safe to change. Savings % should be computed live from prices.
# ------------------------------------------------------------------
PRICING: Dict[str, Any] = {
    "currency": "USD",
    "products": {
        "monthly": {
            "product_id": "cheerplanner_premium_monthly",
            "display_price": 4.99,
            "period": "month",
            "trial_days": 7,
        },
        "annual": {
            "product_id": "cheerplanner_premium_annual",
            "display_price": 39.99,
            "period": "year",
            "trial_days": 7,
        },
    },
    "revenuecat_entitlement_id": "premium",
    "revenuecat_offering_id": "default",
}

# Map App Store / RevenueCat product IDs -> our plan name.
PRODUCT_PLAN_MAP = {
    "cheerplanner_premium_monthly": "monthly",
    "cheerplanner_premium_annual": "annual",
}


def limit_for(is_premium: bool, key: str) -> int:
    """Return the configured limit for a key. -1 means unlimited."""
    tier = "premium" if is_premium else "free"
    return PLAN_LIMITS.get(tier, {}).get(key, 0)


def is_unlimited(value: int) -> bool:
    return value < 0
