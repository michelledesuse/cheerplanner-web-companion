"""Premium entitlement API (Phase 0).

Read-only surface for the client to learn:
  - GET /api/entitlements/me      -> current household Premium status
  - GET /api/entitlements/config  -> plan limits + pricing display metadata

Phase 0 grants nothing and blocks nothing: with no entitlement docs, every
household resolves to Free. This is a safe, invisible foundation.
"""
from fastapi import APIRouter, Depends

from core.security import get_current_user
from core.entitlements import get_household_premium
from core.plans import PLAN_LIMITS, PRICING, PREMIUM_TEAM_HUB_FEATURES

router = APIRouter(prefix="/api/entitlements")


@router.get("/me")
async def my_premium_status(current_user=Depends(get_current_user)):
    status = await get_household_premium(current_user["id"])
    return status


@router.get("/config")
async def plan_config(current_user=Depends(get_current_user)):
    return {
        "limits": PLAN_LIMITS,
        "pricing": PRICING,
        "premium_team_hub_features": sorted(PREMIUM_TEAM_HUB_FEATURES),
    }
