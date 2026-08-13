from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import Booking, BookingCreate, BookingUpdate
from core.security import get_current_user, require_visibility
from core.helpers import _household_user_ids

router = APIRouter(prefix="/api")


@router.get("/bookings", response_model=List[Booking])
async def list_bookings(
    competition_id: Optional[str] = None,
    current_user=Depends(require_visibility("travel")),
):
    q = {"user_id": {"$in": await _household_user_ids(current_user["id"])}}
    if competition_id:
        q["competition_id"] = competition_id
    docs = await db.bookings.find(q, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [Booking(**d) for d in docs]


@router.post("/bookings", response_model=Booking)
async def create_booking(payload: BookingCreate, current_user=Depends(require_visibility("travel"))):
    if payload.type not in ("hotel", "car", "flight"):
        raise HTTPException(status_code=400, detail="Invalid booking type")
    data = payload.model_dump()
    if data.get("sms_reminder_offsets") is None:
        data["sms_reminder_offsets"] = []
    # For flights: if leg-level costs are provided and total `cost` is missing/zero,
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


@router.patch("/bookings/{booking_id}", response_model=Booking)
async def update_booking(booking_id: str, payload: BookingUpdate, current_user=Depends(require_visibility("travel"))):
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
    # For flights: keep `cost` in sync with leg costs unless caller explicitly overrode it.
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


@router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, current_user=Depends(require_visibility("travel"))):
    res = await db.bookings.delete_one({
        "id": booking_id, "user_id": {"$in": await _household_user_ids(current_user["id"])}
    })
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"deleted": True}
