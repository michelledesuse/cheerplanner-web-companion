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
    TeamToWatch, ImportCommitPayload, ALLOWED_IMPORT_KINDS, TEAM_IMPORT_KINDS,
    RosterMember, Team, SizeSheet, SizeColumn, DEFAULT_SIZE_COLUMNS,
    PaperworkSheet, PaperworkItem, PaymentTracker, TeamPaymentEntry,
)
from core.security import get_current_user
from core.helpers import _household_user_ids, _expand_recurrence
from core.gating import assert_premium

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


def _norm_name(s) -> str:
    return " ".join(str(s or "").strip().lower().split())


async def _build_roster_index(member_ids) -> dict:
    """Map of normalized roster-member name -> member id for a household."""
    idx = {}
    async for m in db.roster.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1}):
        idx[_norm_name(m.get("name"))] = m["id"]
    return idx


def _split_name(full: str):
    parts = (full or "").strip().split()
    if not parts:
        return None, None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


async def _resolve_member(name, user_id, member_ids, index, created_names, default_role="athlete"):
    """Return an existing roster member id by name, or create one and return its id."""
    key = _norm_name(name)
    if key in index:
        return index[key]
    fn, ln = _split_name(name)
    m = RosterMember(user_id=user_id, name=name.strip(), first_name=fn, last_name=ln, role=default_role)
    await db.roster.insert_one(m.model_dump())
    index[key] = m.id
    created_names.append(name.strip())
    return m.id


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
    if kind in TEAM_IMPORT_KINDS and not current_user.get("team_access"):
        raise HTTPException(status_code=403, detail="Team Hub access is limited to team personnel")
    if kind in TEAM_IMPORT_KINDS:
        await assert_premium(current_user["id"], "spreadsheet_import")
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
        if kind == "roster":
            rows = import_helpers.parse_roster(file.filename or "upload", content)
            teams = await db.teams.find(
                {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(500)
            return {"kind": kind, "rows": rows, "count": len(rows), "existing_teams": teams}
        if kind in ("team_sizes", "team_paperwork"):
            data = import_helpers.parse_named_grid(file.filename or "upload", content)
            members = await db.roster.find(
                {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(1000)
            return {"kind": kind, "columns": data["columns"], "rows": data["rows"],
                    "count": len(data["rows"]), "existing_members": members}
        if kind == "team_payments":
            rows = import_helpers.parse_team_payments(file.filename or "upload", content)
            members = await db.roster.find(
                {"user_id": {"$in": await _household_user_ids(current_user["id"])}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(1000)
            return {"kind": kind, "rows": rows, "count": len(rows), "existing_members": members}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("Import parse failed")
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")


@router.post("/import/commit")
async def import_commit(payload: ImportCommitPayload, current_user=Depends(get_current_user)):
    if payload.kind not in ALLOWED_IMPORT_KINDS:
        raise HTTPException(status_code=400, detail="Unknown import kind")
    if payload.kind in TEAM_IMPORT_KINDS and not current_user.get("team_access"):
        raise HTTPException(status_code=403, detail="Team Hub access is limited to team personnel")
    if payload.kind in TEAM_IMPORT_KINDS:
        await assert_premium(current_user["id"], "spreadsheet_import")
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

    # ------------------------------------------------------------------
    # Team Hub imports
    # ------------------------------------------------------------------
    member_ids = await _household_user_ids(user_id)

    if payload.kind == "roster":
        # Resolve/create teams by name.
        team_name_to_id = {}
        async for t in db.teams.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1}):
            team_name_to_id[_norm_name(t.get("name"))] = t["id"]
        existing = await _build_roster_index(member_ids)
        for row in payload.rows:
            name = (row.get("name") or "").strip()
            if not name:
                skipped += 1
                continue
            team_ids = []
            for tn in (row.get("team_names") or []):
                key = _norm_name(tn)
                tid = team_name_to_id.get(key)
                if not tid:
                    t = Team(user_id=user_id, name=str(tn).strip())
                    await db.teams.insert_one(t.model_dump())
                    tid = t.id
                    team_name_to_id[key] = tid
                    warnings.append(f"Created team '{str(tn).strip()}'.")
                team_ids.append(tid)
            fields = {
                "first_name": row.get("first_name"),
                "last_name": row.get("last_name"),
                "role": row.get("role") or "athlete",
                "phone": row.get("phone"),
                "email": row.get("email"),
                "parent_first_name": row.get("parent_first_name"),
                "parent_last_name": row.get("parent_last_name"),
                "parent_phone": row.get("parent_phone"),
                "parent_email": row.get("parent_email"),
                "notes": row.get("notes"),
            }
            key = _norm_name(name)
            if key in existing:  # update existing person
                mid = existing[key]
                upd = {k: v for k, v in fields.items() if v}
                if team_ids:
                    upd["team_ids"] = team_ids
                if upd:
                    await db.roster.update_one({"id": mid}, {"$set": upd})
                created += 1
            else:
                m = RosterMember(user_id=user_id, name=name, team_ids=team_ids,
                                 **{k: v for k, v in fields.items() if v is not None})
                await db.roster.insert_one(m.model_dump())
                existing[key] = m.id
                created += 1
        return {"created": created, "skipped": skipped, "warnings": warnings}

    if payload.kind == "team_sizes":
        index = await _build_roster_index(member_ids)
        created_names = []
        sheet = await db.size_sheets.find_one({"user_id": {"$in": member_ids}}, {"_id": 0})
        if not sheet:
            cols = [SizeColumn(label=l, is_default=True, order=i).model_dump() for i, l in enumerate(DEFAULT_SIZE_COLUMNS)]
            sheet = SizeSheet(user_id=user_id, columns=cols).model_dump()
            await db.size_sheets.insert_one(sheet)
        columns = sheet.get("columns") or []
        label_to_col = {_norm_name(c["label"]): c["id"] for c in columns}
        order_start = max([c.get("order", 0) for c in columns], default=-1) + 1
        for label in (payload.columns or []):
            if _norm_name(label) not in label_to_col:
                col = SizeColumn(label=label, is_default=False, order=order_start)
                order_start += 1
                columns.append(col.model_dump())
                label_to_col[_norm_name(label)] = col.id
        values = sheet.get("values") or {}
        for row in payload.rows:
            name = (row.get("name") or "").strip()
            if not name:
                skipped += 1
                continue
            mid = await _resolve_member(name, user_id, member_ids, index, created_names)
            mv = values.get(mid) or {}
            for label, val in (row.get("cells") or {}).items():
                cid = label_to_col.get(_norm_name(label))
                if not cid:
                    col = SizeColumn(label=label, is_default=False, order=order_start)
                    order_start += 1
                    columns.append(col.model_dump())
                    label_to_col[_norm_name(label)] = col.id
                    cid = col.id
                if str(val).strip():
                    mv[cid] = str(val).strip()
            values[mid] = mv
            created += 1
        await db.size_sheets.update_one({"id": sheet["id"]}, {"$set": {"columns": columns, "values": values}})
        if created_names:
            warnings.append(f"Added {len(created_names)} new roster member(s): {', '.join(created_names[:8])}{'…' if len(created_names) > 8 else ''}")
        return {"created": created, "skipped": skipped, "warnings": warnings}

    if payload.kind == "team_paperwork":
        index = await _build_roster_index(member_ids)
        created_names = []
        items = [PaperworkItem(label=l, order=i).model_dump() for i, l in enumerate(payload.columns or [])]
        label_to_item = {_norm_name(it["label"]): it["id"] for it in items}
        sheet = PaperworkSheet(user_id=user_id, name=(payload.sheet_name or "Imported Paperwork").strip(), items=items)
        sheet_doc = sheet.model_dump()
        values = {}
        for row in payload.rows:
            name = (row.get("name") or "").strip()
            if not name:
                skipped += 1
                continue
            mid = await _resolve_member(name, user_id, member_ids, index, created_names)
            per_item = {}
            for label, val in (row.get("cells") or {}).items():
                iid = label_to_item.get(_norm_name(label))
                if not iid:
                    it = PaperworkItem(label=label, order=len(items))
                    items.append(it.model_dump())
                    label_to_item[_norm_name(label)] = it.id
                    iid = it.id
                done = import_helpers._bool_from(val)
                per_item[iid] = {"done": bool(done), "note": None}
            values[mid] = per_item
            created += 1
        sheet_doc["items"] = items
        sheet_doc["values"] = values
        await db.paperwork_sheets.insert_one(sheet_doc)
        if created_names:
            warnings.append(f"Added {len(created_names)} new roster member(s): {', '.join(created_names[:8])}{'…' if len(created_names) > 8 else ''}")
        return {"created": created, "skipped": skipped, "warnings": warnings}

    if payload.kind == "team_payments":
        index = await _build_roster_index(member_ids)
        created_names = []
        entries = []
        for row in payload.rows:
            name = (row.get("name") or "").strip()
            if not name:
                skipped += 1
                continue
            mid = await _resolve_member(name, user_id, member_ids, index, created_names)
            entries.append(TeamPaymentEntry(
                member_id=mid,
                paid=bool(row.get("paid")),
                amount_paid=row.get("amount_paid"),
                method=row.get("method"),
                paid_at=row.get("paid_on"),
            ).model_dump())
            created += 1
        tracker = PaymentTracker(
            user_id=user_id,
            name=(payload.sheet_name or "Imported Payments").strip(),
            amount=payload.tracker_amount,
            entries=entries,
        )
        await db.payment_trackers.insert_one(tracker.model_dump())
        if created_names:
            warnings.append(f"Added {len(created_names)} new roster member(s): {', '.join(created_names[:8])}{'…' if len(created_names) > 8 else ''}")
        return {"created": created, "skipped": skipped, "warnings": warnings}

    return {"created": created, "skipped": skipped, "warnings": warnings}
