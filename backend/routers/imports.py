import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response

import import_helpers

from core.db import db
from core.models import (
    Athlete, Competition, Booking, ExpenseEntry, ScheduleEvent, RecurrenceRule,
    TeamToWatch, ImportCommitPayload, ALLOWED_IMPORT_KINDS,
)
from core.security import get_current_user
from core.helpers import _household_user_ids, _expand_recurrence

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


@router.get("/import/template/{kind}")
async def import_template(kind: str, fmt: str = "csv", current_user=Depends(get_current_user)):
    if kind not in ALLOWED_IMPORT_KINDS:
        raise HTTPException(status_code=400, detail="Unknown template")
    if fmt == "xlsx":
        data = import_helpers.render_template_xlsx(kind)
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="cheerplanner-{kind}-template.xlsx"'},
        )
    csv_text = import_helpers.render_template_csv(kind)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="cheerplanner-{kind}-template.csv"'},
    )


@router.post("/import/preview")
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
            existing = await db.competitions.find(
                {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(500)
            return {"kind": kind, "rows": rows, "count": len(rows), "existing_competitions": existing}
        if kind == "expenses":
            data = import_helpers.parse_expenses(file.filename or "upload", content)
            existing_athletes = await db.athletes.find(
                {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(500)
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
        if kind == "teams_to_watch":
            rows = import_helpers.parse_teams_to_watch(file.filename or "upload", content)
            existing = await db.competitions.find(
                {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(500)
            return {"kind": kind, "rows": rows, "count": len(rows), "existing_competitions": existing}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("Import parse failed")
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")


@router.post("/import/commit")
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
        existing = await db.competitions.find(
            {"user_id": user_id}, {"_id": 0, "id": 1, "name": 1, "event_date": 1},
        ).to_list(500)
        name_to_id = {str(c["name"]).strip().lower(): c["id"] for c in existing}
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
                    pickup_at=b.get("pickup_at"),
                    pickup_location=b.get("pickup_location"),
                    dropoff_at=b.get("dropoff_at"),
                    dropoff_location=b.get("dropoff_location"),
                    flight_number=b.get("flight_number"),
                    depart_airport=b.get("depart_airport"),
                    arrive_airport=b.get("arrive_airport"),
                    depart_time=b.get("depart_time"),
                    arrive_time=b.get("arrive_time"),
                    outbound_cost=b.get("outbound_cost"),
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
        athlete_map = payload.athlete_map or {}
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

    if payload.kind == "teams_to_watch":
        existing = await db.competitions.find(
            {"user_id": user_id}, {"_id": 0, "id": 1, "name": 1},
        ).to_list(500)
        name_to_id = {str(c["name"]).strip().lower(): c["id"] for c in existing}
        explicit = payload.competition_map or {}
        for row in payload.rows:
            tname = (row.get("name") or "").strip()
            cname = (row.get("competition") or "").strip()
            if not tname or not cname:
                skipped += 1
                continue
            comp_id = explicit.get(cname) or name_to_id.get(cname.lower())
            if not comp_id:
                if not payload.create_missing_competitions:
                    skipped += 1
                    warnings.append(f"Skipped '{tname}' — no competition named '{cname}'.")
                    continue
                comp = Competition(
                    user_id=user_id,
                    name=cname,
                    event_date=row.get("date") or datetime.now(timezone.utc).date().isoformat(),
                )
                await db.competitions.insert_one(comp.model_dump())
                comp_id = comp.id
                name_to_id[cname.lower()] = comp_id
                warnings.append(f"Created placeholder competition '{cname}' — please set the event date.")
            tw = TeamToWatch(
                name=tname,
                date=row.get("date"),
                location=row.get("location"),
                performance_time=row.get("performance_time"),
            )
            await db.competitions.update_one(
                {"id": comp_id, "user_id": user_id},
                {"$push": {"teams_to_watch": tw.model_dump()}},
            )
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
