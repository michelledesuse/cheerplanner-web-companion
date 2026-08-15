"""Household activity feed — surfaces when ANOTHER household member adds or
changes a competition or schedule event, shown as a banner on the Home tab.

An activity is "seen" by a member either automatically (when they open the item)
or via "Mark all seen". The actor is pre-marked as having seen their own action,
so members never get notified about their own edits (and solo households — where
the actor is the only member — get no notifications at all).
"""
import uuid
from typing import Optional

from core.db import db
from core.models import utcnow_iso
from core.helpers import _get_or_create_household


async def log_activity(
    *, actor_user_id: str, resource: str, resource_id: str,
    resource_name: str, action: str,
) -> None:
    """Record a household activity. `resource`: 'competition' | 'event'.
    `action`: 'added' | 'updated'. Never raises."""
    try:
        h = await _get_or_create_household(actor_user_id)
        # Only worth recording when the household has more than one member.
        if len(h.get("member_user_ids") or []) <= 1:
            return
        await db.household_activity.insert_one({
            "id": str(uuid.uuid4()),
            "household_id": h["id"],
            "actor_user_id": actor_user_id,
            "resource": resource,
            "resource_id": resource_id,
            "resource_name": (resource_name or "").strip()[:120] or resource.capitalize(),
            "action": action,
            "seen_by": [actor_user_id],
            "created_at": utcnow_iso(),
        })
    except Exception:
        pass
