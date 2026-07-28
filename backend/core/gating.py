"""Feature-gating helpers (Phase 1d).

Central premium checks used by Team Hub routers. Free users get 402 with a
machine-readable detail so the client can show the paywall:
  - "premium_required:<feature>"   → a Premium-only feature
  - "limit_reached:<key>"          → a Free count/limit was hit

Reads are never blocked here (so Free users can still SEE their existing data);
only create/write actions that exceed the Free tier raise.
"""
from fastapi import HTTPException

from core.entitlements import get_household_premium
from core.plans import limit_for


async def is_premium(user_id: str) -> bool:
    status = await get_household_premium(user_id)
    return bool(status.get("is_premium"))


async def assert_premium(user_id: str, feature: str = "this feature") -> None:
    if not await is_premium(user_id):
        raise HTTPException(status_code=402, detail=f"premium_required:{feature}")


async def assert_under_count(user_id: str, key: str, current_count: int) -> None:
    """Raise 402 if a Free household is at/over the configured count for `key`."""
    if await is_premium(user_id):
        return
    lim = limit_for(False, key)
    if lim >= 0 and current_count >= lim:
        raise HTTPException(status_code=402, detail=f"limit_reached:{key}")
