"""One-time migration: split existing multi-day schedule events into a per-day series.

A multi-day event was stored as a single document (date + end_date). This makes
each day its own editable event (end_date cleared, shared series_id) so users can
set different links/times per day. Recurrence-series docs already have end_date
null, so they are not affected.

Run: python -m scripts.migrate_multiday_events   (from /app/backend)
"""
import asyncio
import uuid

from core.db import db
from core.helpers import _date_range


async def main():
    cursor = db.schedule_events.find({"end_date": {"$nin": [None, ""]}}, {"_id": 0})
    converted = 0
    inserted = 0
    async for ev in cursor:
        start = ev.get("date")
        end = ev.get("end_date")
        if not (start and end and end > start):
            continue
        dates = _date_range(start, end)
        if len(dates) < 2:
            # single-day range; just clear end_date
            await db.schedule_events.update_one({"id": ev["id"]}, {"$set": {"end_date": None}})
            continue
        series_id = ev.get("series_id") or str(uuid.uuid4())
        # Day 1 keeps the original id; clear end_date and attach series.
        await db.schedule_events.update_one(
            {"id": ev["id"]},
            {"$set": {"end_date": None, "series_id": series_id, "date": dates[0]}},
        )
        # Days 2..N become new docs cloned from the original.
        new_docs = []
        for d in dates[1:]:
            clone = {k: v for k, v in ev.items() if k != "_id"}
            clone["id"] = str(uuid.uuid4())
            clone["date"] = d
            clone["end_date"] = None
            clone["series_id"] = series_id
            new_docs.append(clone)
        if new_docs:
            await db.schedule_events.insert_many(new_docs)
            inserted += len(new_docs)
        converted += 1
    print(f"Converted {converted} multi-day events; inserted {inserted} new per-day docs.")


if __name__ == "__main__":
    asyncio.run(main())
