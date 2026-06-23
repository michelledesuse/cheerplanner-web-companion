from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import BulkDeletePayload, BULK_DELETE_COLLECTIONS
from core.security import get_current_user
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api")


@router.post("/bulk-delete")
async def bulk_delete(payload: BulkDeletePayload, current_user=Depends(get_current_user)):
    """Delete many records of a single resource type in one call.

    Scoped to household — a co-parent can purge records the other parent
    created. Returns the count of records actually deleted (matches Mongo's
    `deleted_count`) so the client can show "Deleted N items".
    """
    coll_name = BULK_DELETE_COLLECTIONS.get(payload.resource)
    if not coll_name:
        raise HTTPException(status_code=400, detail=f"Unsupported resource '{payload.resource}'")
    if not payload.ids:
        return {"deleted": 0}
    member_ids = await _household_user_ids(current_user["id"])
    res = await db[coll_name].delete_many({
        "id": {"$in": payload.ids},
        "user_id": {"$in": member_ids},
    })
    return {"deleted": res.deleted_count, "resource": payload.resource}
