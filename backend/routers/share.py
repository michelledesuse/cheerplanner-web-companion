"""Public share links for Team Hub tools.

Coaches generate a token-based link for a sign-up sheet, the roster, or the
sizes sheet. Parents open the link in any browser (no app, no login) and fill
in their part. Submissions auto-apply.

Privacy model:
  • Sign-ups: everyone can see everyone's claims.
  • Roster / Sizes: a parent only ever sees the blank form they're filling —
    they never see other people's entered data.
"""
import secrets
import html as _html

from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import HTMLResponse

from core.db import db
from core.models import (
    ShareLink, ShareLinkCreate, RosterMember, SignupClaim,
    SizeSheet, SizeColumn, DEFAULT_SIZE_COLUMNS,
)
from core.security import get_current_user, require_team_access
from core.helpers import _household_user_ids
from core.gating import assert_premium
from core.sms import send_sms, is_configured, normalize_us_phone

router = APIRouter(prefix="/api")


def _norm(s) -> str:
    return " ".join(str(s or "").strip().lower().split())


# ============================================================
# Authed management (team personnel)
# ============================================================
@router.post("/team/share", dependencies=[Depends(require_team_access)])
async def create_share(payload: ShareLinkCreate, current_user=Depends(get_current_user)):
    await assert_premium(current_user["id"], "parent_share_links")
    member_ids = await _household_user_ids(current_user["id"])
    if payload.kind == "signup":
        if not payload.ref_id:
            raise HTTPException(status_code=400, detail="ref_id (sheet) required")
        sheet = await db.signup_sheets.find_one({"id": payload.ref_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
        if not sheet:
            raise HTTPException(status_code=404, detail="Sign-up sheet not found")
    if payload.kind == "roster_member":
        if not payload.ref_id:
            raise HTTPException(status_code=400, detail="ref_id (member) required")
        m = await db.roster.find_one({"id": payload.ref_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
        if not m:
            raise HTTPException(status_code=404, detail="Roster member not found")
    # Reuse an existing active link for the same kind+ref in this household.
    existing = await db.share_links.find_one(
        {"kind": payload.kind, "ref_id": payload.ref_id, "user_id": {"$in": member_ids}, "active": True},
        {"_id": 0},
    )
    if existing:
        return {"token": existing["token"], "kind": existing["kind"], "id": existing["id"]}
    link = ShareLink(token=secrets.token_urlsafe(9), kind=payload.kind, ref_id=payload.ref_id, user_id=current_user["id"])
    await db.share_links.insert_one(link.model_dump())
    return {"token": link.token, "kind": link.kind, "id": link.id}


@router.post("/team/roster/{member_id}/request-info", dependencies=[Depends(require_team_access)])
async def request_member_info(member_id: str, payload: dict = Body(default={}), current_user=Depends(get_current_user)):
    """Create (or reuse) a member-specific completion link so an existing roster
    member can finish their missing info. Optionally text it to them.

    Body: { base_url: str, send: bool }
      • base_url — the app's public backend origin (e.g. EXPO_PUBLIC_BACKEND_URL),
        used to build the shareable /api/public/s/<token> URL.
      • send — if true and a phone number is on file, text the link via Twilio.
    """
    await assert_premium(current_user["id"], "parent_share_links")
    member_ids = await _household_user_ids(current_user["id"])
    m = await db.roster.find_one({"id": member_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Roster member not found")

    existing = await db.share_links.find_one(
        {"kind": "roster_member", "ref_id": member_id, "user_id": {"$in": member_ids}, "active": True},
        {"_id": 0},
    )
    if existing:
        token = existing["token"]
    else:
        link = ShareLink(token=secrets.token_urlsafe(9), kind="roster_member", ref_id=member_id, user_id=current_user["id"])
        await db.share_links.insert_one(link.model_dump())
        token = link.token

    base = str(payload.get("base_url") or "").rstrip("/")
    if not base.startswith("https://"):
        raise HTTPException(status_code=400, detail="A valid https base_url is required")
    url = f"{base}/api/public/s/{token}"

    # Prefer the athlete's own phone; fall back to the parent/guardian phone.
    raw_phone = m.get("phone") or m.get("parent_phone")
    phone = normalize_us_phone(raw_phone)

    sent = False
    if payload.get("send"):
        if not is_configured():
            raise HTTPException(status_code=400, detail="SMS isn't set up yet. Add your Twilio number in Settings, or copy the link and send it yourself.")
        if not phone:
            raise HTTPException(status_code=400, detail="No phone number on file for this person. Copy the link and send it yourself.")
        who = m.get("preferred_name") or m.get("first_name") or "there"
        body = f"Hi {who}! Please complete your team roster info here: {url}"
        sent = send_sms(phone, body)
        if sent:
            from core.models import utcnow_iso as _now
            await db.roster.update_one({"id": member_id}, {"$set": {"last_reminded_at": _now()}})

    return {"token": token, "url": url, "phone": phone, "has_phone": bool(phone), "sent": sent}


@router.delete("/team/share/{link_id}", dependencies=[Depends(require_team_access)])
async def revoke_share(link_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.share_links.update_one(
        {"id": link_id, "user_id": {"$in": member_ids}}, {"$set": {"active": False}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"revoked": True}


# ============================================================
# Public helpers (no auth)
# ============================================================
async def _get_link(token: str) -> dict:
    link = await db.share_links.find_one({"token": token, "active": True}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="This link is invalid or has been turned off.")
    return link


async def _size_sheet(member_ids):
    doc = await db.size_sheets.find_one({"user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        cols = [SizeColumn(label=l, is_default=True, order=i).model_dump() for i, l in enumerate(DEFAULT_SIZE_COLUMNS)]
        doc = SizeSheet(user_id=member_ids[0], columns=cols).model_dump()
        await db.size_sheets.insert_one(doc)
    return doc


@router.get("/public/share/{token}/data")
async def public_data(token: str):
    link = await _get_link(token)
    member_ids = await _household_user_ids(link["user_id"])
    if link["kind"] == "signup":
        sheet = await db.signup_sheets.find_one({"id": link["ref_id"], "user_id": {"$in": member_ids}}, {"_id": 0})
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet not found")
        # Resolve claim display names (roster name or guest name).
        rmap = {}
        async for m in db.roster.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1}):
            rmap[m["id"]] = m.get("name")
        slots = []
        for s in sorted(sheet.get("slots") or [], key=lambda x: x.get("order", 0)):
            claims = []
            for c in (s.get("claims") or []):
                nm = c.get("guest_name") or rmap.get(c.get("member_id")) or "Someone"
                claims.append({"name": nm, "qty": c.get("qty", 1), "note": c.get("note")})
            claimed = sum(int(c.get("qty") or 0) for c in (s.get("claims") or []))
            slots.append({
                "id": s["id"], "label": s["label"], "kind": s.get("kind", "item"),
                "time_label": s.get("time_label"), "qty_needed": s.get("qty_needed", 1),
                "claimed": claimed, "claims": claims,
            })
        roster_names = sorted([v for v in rmap.values() if v], key=lambda n: n.lower())
        slots.sort(key=lambda s: (1 if s["claimed"] >= s["qty_needed"] else 0))
        return {"kind": "signup", "title": sheet.get("name"), "slots": slots, "roster_names": roster_names}
    if link["kind"] in ("roster", "roster_member"):
        doc = await _size_sheet(member_ids)
        cols = sorted(doc.get("columns") or [], key=lambda c: c.get("order", 0))
        teams = []
        async for t in db.teams.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1}):
            teams.append({"id": t["id"], "name": t.get("name")})
        teams.sort(key=lambda t: (t["name"] or "").lower())
        out = {"kind": link["kind"], "title": "Team Roster",
               "size_columns": [{"id": c["id"], "label": c["label"]} for c in cols],
               "teams": teams}
        if link["kind"] == "roster_member":
            m = await db.roster.find_one({"id": link.get("ref_id"), "user_id": {"$in": member_ids}}, {"_id": 0})
            if not m:
                raise HTTPException(status_code=404, detail="This person is no longer on the roster.")
            sizes_vals = (doc.get("values") or {}).get(m["id"], {})
            out["title"] = m.get("name") or "Your info"
            out["member"] = {
                "id": m["id"],
                "first_name": m.get("first_name") or "",
                "last_name": m.get("last_name") or "",
                "preferred_name": m.get("preferred_name") or "",
                "role": m.get("role") or "athlete",
                "team_ids": m.get("team_ids") or [],
                "phone": m.get("phone") or "",
                "email": m.get("email") or "",
                "parent_first_name": m.get("parent_first_name") or "",
                "parent_last_name": m.get("parent_last_name") or "",
                "parent_phone": m.get("parent_phone") or "",
                "parent_email": m.get("parent_email") or "",
                "parent_relationship": m.get("parent_relationship") or "",
                "parent_include_in_texts": m.get("parent_include_in_texts", True),
                "caretakers": m.get("caretakers") or [],
                "dob": m.get("dob") or "",
                "adult_athlete": bool(m.get("adult_athlete")),
                "food_allergies": m.get("food_allergies") or "",
                "other_allergies": m.get("other_allergies") or "",
                "medical_concerns": m.get("medical_concerns") or "",
                "host_bonding_opt_in": m.get("host_bonding_opt_in"),
                "photo": m.get("photo") or "",
                "sizes": sizes_vals,
            }
        return out
    if link["kind"] == "sizes":
        doc = await _size_sheet(member_ids)
        cols = sorted(doc.get("columns") or [], key=lambda c: c.get("order", 0))
        members = []
        async for m in db.roster.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1}):
            members.append({"id": m["id"], "name": m.get("name")})
        members.sort(key=lambda m: (m["name"] or "").lower())
        return {"kind": "sizes", "title": "Team Sizes",
                "columns": [{"id": c["id"], "label": c["label"]} for c in cols], "members": members}
    if link["kind"] == "form":
        form = await db.team_forms.find_one({"id": link["ref_id"], "user_id": {"$in": member_ids}}, {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Form not found")
        from routers.team_forms import apply_form_autolock
        await apply_form_autolock(form)
        members = []
        async for m in db.roster.find({"user_id": {"$in": member_ids}, "role": {"$ne": "parent"}}, {"_id": 0, "id": 1, "name": 1}):
            members.append({"id": m["id"], "name": m.get("name")})
        members.sort(key=lambda m: (m["name"] or "").lower())
        # answers keyed by member so parents can edit their prior response
        answers_by_member = {}
        async for r in db.team_form_responses.find({"form_id": form["id"]}, {"_id": 0, "member_id": 1, "answers": 1}):
            if r.get("member_id"):
                answers_by_member[r["member_id"]] = r.get("answers") or {}
        return {
            "kind": "form", "title": form.get("name"), "description": form.get("description") or "",
            "locked": bool(form.get("locked")), "close_at": form.get("close_at"),
            "questions": sorted(form.get("questions") or [], key=lambda q: q.get("order", 0)),
            "members": members, "answers_by_member": answers_by_member,
        }
    raise HTTPException(status_code=400, detail="Unsupported link")


@router.post("/public/share/{token}/submit")
async def public_submit(token: str, payload: dict = Body(...)):
    link = await _get_link(token)
    member_ids = await _household_user_ids(link["user_id"])

    if link["kind"] == "signup":
        slot_id = payload.get("slot_id")
        name = (payload.get("name") or "").strip()
        if not slot_id or not name:
            raise HTTPException(status_code=400, detail="Please enter your name.")
        sheet = await db.signup_sheets.find_one({"id": link["ref_id"], "user_id": {"$in": member_ids}}, {"_id": 0})
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet not found")
        slots = sheet.get("slots") or []
        slot = next((s for s in slots if s.get("id") == slot_id), None)
        if not slot:
            raise HTTPException(status_code=404, detail="Slot not found")
        claim = SignupClaim(guest_name=name[:80], qty=max(1, int(payload.get("qty") or 1)),
                            note=(payload.get("note") or None)).model_dump()
        slot.setdefault("claims", []).append(claim)
        await db.signup_sheets.update_one({"id": sheet["id"]}, {"$set": {"slots": slots}})
        return {"ok": True}

    if link["kind"] in ("roster", "roster_member"):
        first = (payload.get("first_name") or "").strip()
        last = (payload.get("last_name") or "").strip()
        name = f"{first} {last}".strip()
        if not name:
            raise HTTPException(status_code=400, detail="Please enter a first and last name.")
        role = payload.get("role") if payload.get("role") in ("athlete", "parent", "coach", "team_rep", "staff") else "athlete"
        # Resolve the member to update. For a member-specific link, target that
        # exact person; otherwise upsert by name within the household.
        match = None
        if link["kind"] == "roster_member":
            match = await db.roster.find_one({"id": link.get("ref_id"), "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1})
            if not match:
                raise HTTPException(status_code=404, detail="This person is no longer on the roster.")
        else:
            async for m in db.roster.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1}):
                if _norm(m.get("name")) == _norm(name):
                    match = m
                    break
        fields = {
            "first_name": first or None, "last_name": last or None, "role": role,
            "preferred_name": (payload.get("preferred_name") or "").strip() or None,
            "phone": (payload.get("phone") or "").strip() or None,
            "email": (payload.get("email") or "").strip() or None,
            "parent_first_name": (payload.get("parent_first_name") or "").strip() or None,
            "parent_last_name": (payload.get("parent_last_name") or "").strip() or None,
            "parent_phone": (payload.get("parent_phone") or "").strip() or None,
            "parent_email": (payload.get("parent_email") or "").strip() or None,
            "parent_relationship": (payload.get("parent_relationship") or "").strip() or None,
            "dob": (payload.get("dob") or "").strip() or None,
            "food_allergies": (payload.get("food_allergies") or "").strip() or None,
            "other_allergies": (payload.get("other_allergies") or "").strip() or None,
            "medical_concerns": (payload.get("medical_concerns") or "").strip() or None,
            "photo": (payload.get("photo") or "").strip() or None,
            "notes": (payload.get("notes") or "").strip() or None,
        }
        # team_ids (list) and host_bonding_opt_in (bool) don't fit the truthy filter — handle explicitly.
        extras = {}
        team_ids = payload.get("team_ids")
        if isinstance(team_ids, list) and team_ids:
            valid_team_ids = set()
            async for t in db.teams.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1}):
                valid_team_ids.add(t["id"])
            picked = [t for t in team_ids if t in valid_team_ids]
            if picked:
                extras["team_ids"] = picked
        host = payload.get("host_bonding_opt_in")
        if isinstance(host, bool):
            extras["host_bonding_opt_in"] = host
        pit = payload.get("parent_include_in_texts")
        if isinstance(pit, bool):
            extras["parent_include_in_texts"] = pit
        aa = payload.get("adult_athlete")
        if isinstance(aa, bool):
            extras["adult_athlete"] = aa
        cts = payload.get("caretakers")
        if isinstance(cts, list):
            clean_cts = []
            for ct in cts:
                if not isinstance(ct, dict):
                    continue
                if not ((ct.get("first_name") or "").strip() or (ct.get("phone") or "").strip()):
                    continue
                clean_cts.append({
                    "first_name": (ct.get("first_name") or "").strip() or None,
                    "last_name": (ct.get("last_name") or "").strip() or None,
                    "relationship": (ct.get("relationship") or "").strip() or None,
                    "phone": (ct.get("phone") or "").strip() or None,
                    "email": (ct.get("email") or "").strip() or None,
                    "include_in_texts": bool(ct.get("include_in_texts", True)),
                })
            extras["caretakers"] = clean_cts
        # Flag as a fresh parent submission for coaches to review.
        from core.models import utcnow_iso as _now
        extras["pending_review"] = True
        extras["submitted_at"] = _now()
        if match:
            member_id = match["id"]
            upd = {**{k: v for k, v in fields.items() if v}, **extras}
            # Keep the display name in sync with corrected first/last on a member link.
            if name and _norm(name) != _norm(match.get("name")):
                upd["name"] = name
            if upd:
                await db.roster.update_one({"id": match["id"]}, {"$set": upd})
        else:
            m = RosterMember(user_id=link["user_id"], name=name,
                             **{k: v for k, v in fields.items() if v is not None}, **extras)
            member_id = m.id
            await db.roster.insert_one(m.model_dump())
        # Apply any sizes submitted alongside the roster info.
        sizes_in = payload.get("sizes") or {}
        if sizes_in:
            doc = await _size_sheet(member_ids)
            valid_cols = {c["id"] for c in (doc.get("columns") or [])}
            values = doc.get("values") or {}
            mv = values.get(member_id) or {}
            for cid, val in sizes_in.items():
                if cid not in valid_cols:
                    continue
                v = str(val or "").strip()
                if v:
                    mv[cid] = v
                else:
                    mv.pop(cid, None)
            values[member_id] = mv
            await db.size_sheets.update_one({"id": doc["id"]}, {"$set": {"values": values}})
        return {"ok": True}

    if link["kind"] == "sizes":
        member_id = payload.get("member_id")
        values_in = payload.get("values") or {}
        if not member_id:
            raise HTTPException(status_code=400, detail="Please choose your name.")
        rm = await db.roster.find_one({"id": member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
        if not rm:
            raise HTTPException(status_code=404, detail="Member not found")
        doc = await _size_sheet(member_ids)
        valid_cols = {c["id"] for c in (doc.get("columns") or [])}
        values = doc.get("values") or {}
        mv = values.get(member_id) or {}
        for cid, val in values_in.items():
            if cid not in valid_cols:
                continue
            v = str(val or "").strip()
            if v:
                mv[cid] = v
            else:
                mv.pop(cid, None)
        values[member_id] = mv
        await db.size_sheets.update_one({"id": doc["id"]}, {"$set": {"values": values}})
        return {"ok": True}

    if link["kind"] == "form":
        member_id = payload.get("member_id")
        answers = payload.get("answers") or {}
        if not member_id:
            raise HTTPException(status_code=400, detail="Please choose your name.")
        form = await db.team_forms.find_one({"id": link["ref_id"], "user_id": {"$in": member_ids}}, {"_id": 0})
        if not form:
            raise HTTPException(status_code=404, detail="Form not found")
        from routers.team_forms import apply_form_autolock
        await apply_form_autolock(form)
        if form.get("locked"):
            raise HTTPException(status_code=400, detail="This form is locked — submissions are closed.")
        rm = await db.roster.find_one({"id": member_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1})
        if not rm:
            raise HTTPException(status_code=404, detail="Member not found")
        # keep only answers for known question ids
        valid_qids = {q["id"] for q in (form.get("questions") or [])}
        clean = {k: v for k, v in answers.items() if k in valid_qids}
        from core.models import utcnow_iso as _now
        now = _now()
        existing = await db.team_form_responses.find_one({"form_id": form["id"], "member_id": member_id}, {"_id": 0, "id": 1})
        if existing:
            await db.team_form_responses.update_one(
                {"id": existing["id"]},
                {"$set": {"answers": clean, "respondent_name": rm.get("name"), "updated_at": now, "source": "public"}},
            )
        else:
            await db.team_form_responses.insert_one({
                "id": secrets.token_urlsafe(9), "form_id": form["id"], "user_id": link["user_id"],
                "member_id": member_id, "respondent_name": rm.get("name"), "answers": clean,
                "source": "public", "created_at": now, "updated_at": now,
            })
        return {"ok": True}

    raise HTTPException(status_code=400, detail="Unsupported link")


# ============================================================
# Public HTML page (the shareable link)
# ============================================================
_STYLE = (
    "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;"
    "background:#FAFAF9;color:#0F172A;margin:0;padding:24px 14px;}"
    ".card{max-width:520px;margin:0 auto 16px;background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:18px 16px;}"
    ".brand{max-width:520px;margin:0 auto 12px;font-weight:800;font-size:20px}"
    ".brand .c{color:#007CFF}.brand .p{color:#0F172A}"
    "h1{font-size:20px;margin:0 0 2px}.sub{color:#007CFF;font-weight:700;font-size:13px;margin:0 0 10px}"
    ".slot{border:1px solid #E2E8F0;border-radius:12px;padding:12px;margin-bottom:12px}"
    ".slot h3{margin:0;font-size:16px}.meta{color:#64748B;font-size:13px;margin:2px 0 8px}"
    ".claim{font-size:13px;color:#334155;padding:3px 0}"
    "label{display:block;font-size:12px;color:#475569;font-weight:600;margin:10px 0 4px}"
    "input,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:15px;background:#fff}"
    "button{margin-top:12px;width:100%;background:#007CFF;color:#fff;border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:700;cursor:pointer}"
    ".full{opacity:.6}.ok{color:#059669;font-weight:700;font-size:13px;margin-top:8px}"
    ".row{display:flex;gap:8px}.row>div{flex:1}"
)


@router.get("/public/s/{token}", response_class=HTMLResponse)
async def public_page(token: str):
    try:
        link = await _get_link(token)
    except HTTPException:
        return HTMLResponse(_shell("Link unavailable", "<div class='card'><p>This link is invalid or has been turned off.</p></div>"), status_code=404)
    kind = link["kind"]
    body = f"""
<div id="app" class="card"><p>Loading…</p></div>
<script>
const TOKEN={_js(token)};
const API=location.origin+"/api/public/share/"+TOKEN;
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}}[c]));
async function load(){{
  const r=await fetch(API+"/data"); if(!r.ok){{document.getElementById("app").innerHTML="<p>Link unavailable.</p>";return;}}
  const d=await r.json(); render(d);
}}
async function submit(payload,btn){{
  btn.disabled=true;btn.textContent="Saving…";
  const r=await fetch(API+"/submit",{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify(payload)}});
  const j=await r.json().catch(()=>({{}}));
  if(!r.ok){{alert(j.detail||"Something went wrong");btn.disabled=false;return false;}}
  return true;
}}
function render(d){{
  const KIND={_js(kind)};
  if(KIND==="signup") return renderSignup(d);
  if(KIND==="roster"||KIND==="roster_member") return renderRoster(d);
  if(KIND==="sizes") return renderSizes(d);
  if(KIND==="form") return renderForm(d);
}}
{_JS_SIGNUP}
{_JS_ROSTER}
{_JS_SIZES}
{_JS_FORM}
load();
</script>
"""
    return HTMLResponse(_shell("CheerPlanner", body))


def _js(s: str) -> str:
    import json
    return json.dumps(s)


def _shell(title: str, body: str) -> str:
    return (
        "<!doctype html><html><head><meta charset='utf-8'/>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'/>"
        f"<title>{_html.escape(title)} — CheerPlanner</title><style>{_STYLE}</style></head>"
        "<body><div class='brand'><span class='c'>Cheer</span><span class='p'>Planner</span></div>"
        f"{body}</body></html>"
    )


_JS_SIGNUP = """
function renderSignup(d){
  window._roster=d.roster_names||[];
  let h="<h1>"+esc(d.title)+"</h1><p class='sub'>Volunteer sign-up</p>";
  (d.slots||[]).forEach(s=>{
    const remaining=Math.max(0,s.qty_needed-s.claimed); const full=remaining===0;
    h+="<div class='slot"+(full?" full":"")+"'><h3>"+esc(s.label)+"</h3>";
    if(s.time_label) h+="<div class='meta'>"+esc(s.time_label)+"</div>";
    h+="<div class='meta'>"+s.claimed+"/"+s.qty_needed+" filled"+(remaining>0?(" · "+remaining+" needed"):" · complete")+"</div>";
    (s.claims||[]).forEach(c=>{h+="<div class='claim'>✔ "+esc(c.name)+(c.qty>1?(" ×"+c.qty):"")+(c.note?(" — "+esc(c.note)):"")+"</div>";});
    h+="<label>Your name</label>";
    let opts="<option value=''>Choose your name…</option>";
    (window._roster||[]).forEach(n=>{opts+="<option value='"+esc(n)+"'>"+esc(n)+"</option>";});
    opts+="<option value='__other__'>Other (type name)…</option>";
    h+="<select id='sel_"+s.id+"' onchange='onSel(\\""+s.id+"\\")'>"+opts+"</select>";
    h+="<input id='n_"+s.id+"' style='display:none;margin-top:8px' placeholder='Type your name'/>";
    h+="<div class='row'><div><label>Qty</label><input id='q_"+s.id+"' type='number' value='1' min='1'/></div>";
    h+="<div><label>Note (optional)</label><input id='nt_"+s.id+"' placeholder='e.g. bringing waters'/></div></div>";
    h+="<button onclick='claim(\\""+s.id+"\\",this)'>Sign up</button><div class='ok' id='ok_"+s.id+"'></div></div>";
  });
  document.getElementById("app").innerHTML=h;
}
function onSel(id){
  const v=document.getElementById("sel_"+id).value;
  document.getElementById("n_"+id).style.display=(v==="__other__")?"block":"none";
}
async function claim(id,btn){
  const sel=document.getElementById("sel_"+id).value;
  let name=sel; if(sel==="__other__") name=document.getElementById("n_"+id).value.trim();
  if(!name||name==="__other__"){alert("Please choose or type your name.");return;}
  const qty=document.getElementById("q_"+id).value; const note=document.getElementById("nt_"+id).value;
  const ok=await submit({slot_id:id,name:name,qty:qty,note:note},btn);
  if(ok){document.getElementById("ok_"+id).textContent="You're signed up!";setTimeout(load,700);}
}
"""

_JS_ROSTER = """
function renderRoster(d){
  window._teams=d.teams||[];
  const mem=d.member||null;
  const val=k=>mem&&mem[k]!=null?String(mem[k]):"";
  let h="<h1>"+esc(d.title)+"</h1><p class='sub'>"+(mem?"Please review & complete your info":"Add your info")+"</p>";
  h+="<div class='row'><div><label>First name</label><input id='first' value=\\""+esc(val('first_name'))+"\\"/></div><div><label>Last name</label><input id='last' value=\\""+esc(val('last_name'))+"\\"/></div></div>";
  h+="<label>Preferred name</label><input id='pref' value=\\""+esc(val('preferred_name'))+"\\"/>";
  const roles=['athlete','parent','coach','team_rep','staff'];const rlabels={athlete:'Athlete',parent:'Parent',coach:'Coach',team_rep:'Team Rep',staff:'Staff'};
  h+="<label>Role</label><select id='role'>"+roles.map(r=>"<option value='"+r+"'"+((val('role')||'athlete')===r?" selected":"")+">"+rlabels[r]+"</option>").join("")+"</select>";
  if((d.teams||[]).length){
    h+="<label>Team(s)</label>";
    const mt=(mem&&mem.team_ids)||[];
    (d.teams||[]).forEach(t=>{h+="<div style='display:flex;align-items:center;gap:8px;margin:6px 0'><input type='checkbox' id='tm_"+t.id+"'"+(mt.indexOf(t.id)>=0?" checked":"")+" style='width:auto'/><span>"+esc(t.name)+"</span></div>";});
  }
  h+="<label>Phone</label><input id='phone' value=\\""+esc(val('phone'))+"\\"/><label>Email</label><input id='email' value=\\""+esc(val('email'))+"\\"/>";
  h+="<label>Date of birth</label><input id='dob' placeholder='MM/DD/YYYY' value=\\""+esc(val('dob'))+"\\"/>";
  h+="<label style='display:flex;align-items:center;gap:8px;margin-top:12px'><input type='checkbox' id='adult' style='width:auto'"+(mem&&mem.adult_athlete?" checked":"")+"/><span>Adult athlete — include the athlete's own phone in team texts</span></label>";
  h+="<div style='margin-top:14px;font-weight:700;color:#0F172A'>Caretaker 1 (parent / guardian)</div>";
  h+="<div class='row'><div><label>First name</label><input id='pfirst' value=\\""+esc(val('parent_first_name'))+"\\"/></div><div><label>Last name</label><input id='plast' value=\\""+esc(val('parent_last_name'))+"\\"/></div></div>";
  const REL=['','Mother','Father','Guardian','Grandparent','Other'];
  h+="<label>Relationship</label><select id='prel'>"+REL.map(r=>"<option value='"+r+"'"+((val('parent_relationship')||'')===r?" selected":"")+">"+(r||'Relationship…')+"</option>").join("")+"</select>";
  h+="<label>Phone</label><input id='pphone' value=\\""+esc(val('parent_phone'))+"\\"/><label>Email</label><input id='pemail' value=\\""+esc(val('parent_email'))+"\\"/>";
  const pit=mem?mem.parent_include_in_texts!==false:true;
  h+="<label style='display:flex;align-items:center;gap:8px;margin-top:8px'><input type='checkbox' id='pit' style='width:auto'"+(pit?" checked":"")+"/><span>Include in team texts</span></label>";
  h+="<div id='cts'></div>";
  h+="<button type='button' id='addCt' onclick='addCt()' style='background:#EFF6FF;color:#2563EB;margin-top:10px'>+ Add another caretaker</button>";
  h+="<div style='margin-top:14px;font-weight:700;color:#0F172A'>Health & extra info</div>";
  h+="<label>Food allergies</label><input id='food' value=\\""+esc(val('food_allergies'))+"\\"/>";
  h+="<label>Other allergies</label><input id='oallergy' value=\\""+esc(val('other_allergies'))+"\\"/>";
  h+="<label>Medical concerns</label><input id='medical' value=\\""+esc(val('medical_concerns'))+"\\"/>";
  const hb=mem?mem.host_bonding_opt_in:null;
  h+="<label>Host bonding opt-in</label><select id='host'><option value=''"+(hb==null?" selected":"")+">Not set</option><option value='yes'"+(hb===true?" selected":"")+">Yes</option><option value='no'"+(hb===false?" selected":"")+">No</option></select>";
  h+="<div style='margin-top:14px;font-weight:700;color:#0F172A'>Photo</div>";
  h+="<div class='meta'>Add one photo of the athlete/staff member (optional).</div>";
  h+="<div id='photoPrev'>"+(val('photo')?("<img src='"+val('photo')+"' style='width:90px;height:90px;object-fit:cover;border-radius:10px;margin-top:8px;border:1px solid #E2E8F0'/>"):"")+"</div>";
  h+="<input id='photo' type='file' accept='image/*' onchange='onPhoto(event)' style='padding:8px'/>";
  window._photo=val('photo')||null;
  window._szcols=(d.size_columns||[]).map(c=>c.id);
  const msizes=(mem&&mem.sizes)||{};
  if((d.size_columns||[]).length){
    h+="<div style='margin-top:14px;font-weight:700;color:#0F172A'>Sizes</div>";
    (d.size_columns||[]).forEach(c=>{h+="<label>"+esc(c.label)+"</label><input id='sz_"+c.id+"' value=\\""+esc(msizes[c.id]||"")+"\\"/>";});
  }
  h+="<button onclick='saveRoster(this)'>Submit</button><div class='ok' id='ok'></div>";
  document.getElementById("app").innerHTML="<div class='card'>"+h+"</div>";
  document.getElementById("app").className="";
  window._cts=(mem&&Array.isArray(mem.caretakers))?mem.caretakers.slice(0,3):[];
  renderCts();
}
function ctBlock(idx,c){
  c=c||{};
  const rel=['','Mother','Father','Guardian','Grandparent','Other'];
  const relOpts=rel.map(r=>"<option value='"+r+"'"+((c.relationship||'')===r?" selected":"")+">"+(r||'Relationship…')+"</option>").join("");
  return "<div class='ctBlock' style='border:1px solid #E2E8F0;border-radius:10px;padding:10px;margin-top:10px'>"
    +"<div style='display:flex;justify-content:space-between;align-items:center'><b>Caretaker "+(idx+2)+"</b>"
    +"<button type='button' onclick='removeCt(this)' style='background:#FEF2F2;color:#DC2626;padding:4px 10px;width:auto'>Remove</button></div>"
    +"<div class='row'><div><label>First name</label><input class='ct_first' value=\\""+esc(c.first_name||'')+"\\"/></div><div><label>Last name</label><input class='ct_last' value=\\""+esc(c.last_name||'')+"\\"/></div></div>"
    +"<label>Relationship</label><select class='ct_rel'>"+relOpts+"</select>"
    +"<label>Phone</label><input class='ct_phone' value=\\""+esc(c.phone||'')+"\\"/>"
    +"<label>Email</label><input class='ct_email' value=\\""+esc(c.email||'')+"\\"/>"
    +"<label style='display:flex;align-items:center;gap:8px;margin-top:8px'><input type='checkbox' class='ct_texts' style='width:auto'"+(c.include_in_texts!==false?" checked":"")+"/><span>Include in team texts</span></label>"
    +"</div>";
}
function collectCts(){
  const out=[];
  document.querySelectorAll('#cts .ctBlock').forEach(b=>{
    const g=cls=>{const el=b.querySelector('.'+cls);return el?el.value:'';};
    out.push({first_name:g('ct_first'),last_name:g('ct_last'),relationship:g('ct_rel'),phone:g('ct_phone'),email:g('ct_email'),include_in_texts:b.querySelector('.ct_texts').checked});
  });
  return out;
}
function renderCts(){
  const box=document.getElementById('cts'); if(!box)return; box.innerHTML="";
  (window._cts||[]).forEach((c,i)=>{box.insertAdjacentHTML('beforeend',ctBlock(i,c));});
  const btn=document.getElementById('addCt'); if(btn) btn.style.display=((window._cts||[]).length>=3)?'none':'block';
}
function addCt(){ window._cts=collectCts(); if(window._cts.length>=3)return; window._cts.push({include_in_texts:true}); renderCts(); }
function removeCt(btn){ const blocks=[...document.querySelectorAll('#cts .ctBlock')]; const i=blocks.indexOf(btn.closest('.ctBlock')); window._cts=collectCts(); if(i>=0){window._cts.splice(i,1);} renderCts(); }
async function saveRoster(btn){
  const g=id=>document.getElementById(id).value;
  if(!g('first').trim()||!g('last').trim()){alert("Please enter a first and last name.");return;}
  const sizes={}; (window._szcols||[]).forEach(id=>{const el=document.getElementById("sz_"+id); if(el) sizes[id]=el.value;});
  const teamIds=(window._teams||[]).map(t=>t.id).filter(id=>{const el=document.getElementById("tm_"+id);return el&&el.checked;});
  const hv=g('host'); let host=null; if(hv==='yes')host=true; else if(hv==='no')host=false;
  const ok=await submit({first_name:g('first'),last_name:g('last'),preferred_name:g('pref'),role:g('role'),
    team_ids:teamIds,phone:g('phone'),email:g('email'),dob:g('dob'),
    adult_athlete:(document.getElementById('adult')||{}).checked||false,
    parent_first_name:g('pfirst'),parent_last_name:g('plast'),parent_phone:g('pphone'),parent_email:g('pemail'),
    parent_relationship:g('prel'),parent_include_in_texts:(document.getElementById('pit')||{}).checked!==false,
    caretakers:collectCts(),
    food_allergies:g('food'),other_allergies:g('oallergy'),medical_concerns:g('medical'),host_bonding_opt_in:host,
    photo:window._photo||null,sizes:sizes},btn);
  if(ok){document.getElementById("ok").textContent="Thanks! Your info was submitted.";btn.textContent="Submitted";}
}
function onPhoto(ev){
  const f=ev.target.files&&ev.target.files[0]; if(!f)return;
  const reader=new FileReader();
  reader.onload=function(e){
    const img=new Image();
    img.onload=function(){
      const max=600; let w=img.width,h=img.height;
      if(w>h&&w>max){h=Math.round(h*max/w);w=max;} else if(h>=w&&h>max){w=Math.round(w*max/h);h=max;}
      const cv=document.createElement('canvas');cv.width=w;cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      window._photo=cv.toDataURL('image/jpeg',0.6);
      document.getElementById('photoPrev').innerHTML="<img src='"+window._photo+"' style='width:90px;height:90px;object-fit:cover;border-radius:10px;margin-top:8px;border:1px solid #E2E8F0'/>";
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(f);
}
"""

_JS_SIZES = """
function renderSizes(d){
  let h="<h1>"+esc(d.title)+"</h1><p class='sub'>Enter your sizes</p>";
  h+="<label>Your name</label><select id='member'><option value=''>Choose your name…</option>";
  (d.members||[]).forEach(m=>{h+="<option value='"+m.id+"'>"+esc(m.name)+"</option>";});
  h+="</select>";
  (d.columns||[]).forEach(c=>{h+="<label>"+esc(c.label)+"</label><input id='c_"+c.id+"'/>";});
  h+="<button onclick='saveSizes(this)'>Submit</button><div class='ok' id='ok'></div>";
  document.getElementById("app").innerHTML="<div class='card'>"+h+"</div>";
  window._cols=(d.columns||[]).map(c=>c.id);
}
async function saveSizes(btn){
  const mid=document.getElementById("member").value; if(!mid){alert("Please choose your name.");return;}
  const values={}; (window._cols||[]).forEach(id=>{values[id]=document.getElementById("c_"+id).value;});
  const ok=await submit({member_id:mid,values:values},btn);
  if(ok){document.getElementById("ok").textContent="Thanks! Your sizes were submitted.";btn.textContent="Submitted";}
}
"""

_JS_FORM = """
function renderForm(d){
  window._q=d.questions||[]; window._abm=d.answers_by_member||{}; window._locked=!!d.locked;
  let h="<h1>"+esc(d.title)+"</h1>";
  if(d.description) h+="<p class='meta'>"+esc(d.description)+"</p>";
  h+="<p class='sub'>"+(d.locked?"This form is locked — submissions are closed.":"Fill out & submit")+"</p>";
  if(!d.locked && d.close_at){
    var cd=new Date(d.close_at);
    if(!isNaN(cd.getTime())){
      var ms=cd.getTime()-Date.now();
      var note = ms<=0 ? "Closed" : ("Closes "+cd.toLocaleDateString(undefined,{month:'short',day:'numeric'})+" · "+
        (ms<86400000 ? "closes today" : ("closes in "+Math.ceil(ms/86400000)+" day"+(Math.ceil(ms/86400000)===1?"":"s"))));
      h+="<p class='meta' style='color:#B45309;font-weight:600'>⏰ "+note+"</p>";
    }
  }
  h+="<label>Your name</label><select id='member' onchange='onMember()'><option value=''>Choose your name…</option>";
  (d.members||[]).forEach(m=>{h+="<option value='"+m.id+"'>"+esc(m.name)+"</option>";});
  h+="</select><div id='qs'></div>";
  if(!d.locked) h+="<button onclick='saveForm(this)'>Submit</button>";
  h+="<div class='ok' id='ok'></div>";
  document.getElementById("app").innerHTML="<div class='card'>"+h+"</div>";
  renderQs({});
}
function onMember(){
  const mid=document.getElementById("member").value;
  renderQs((window._abm||{})[mid]||{});
}
function renderQs(ans){
  let h="";
  (window._q||[]).forEach(q=>{
    const dis=window._locked?" disabled":"";
    const v=ans[q.id];
    h+="<label>"+esc(q.label)+(q.required?" *":"")+"</label>";
    if(q.type==="paragraph"){
      h+="<textarea id='f_"+q.id+"' rows='4' style='width:100%;box-sizing:border-box;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:15px'"+dis+">"+esc(v||"")+"</textarea>";
    } else if(q.type==="number"){
      h+="<input id='f_"+q.id+"' type='number' value=\\""+esc(v==null?"":v)+"\\""+dis+"/>";
    } else if(q.type==="choice"){
      h+="<select id='f_"+q.id+"'"+dis+"><option value=''>Choose…</option>"+(q.options||[]).map(o=>"<option value=\\""+esc(o)+"\\""+(v===o?" selected":"")+">"+esc(o)+"</option>").join("")+"</select>";
    } else if(q.type==="yesno"){
      h+="<select id='f_"+q.id+"'"+dis+"><option value=''>Choose…</option><option value='Yes'"+(v==="Yes"?" selected":"")+">Yes</option><option value='No'"+(v==="No"?" selected":"")+">No</option></select>";
    } else if(q.type==="multi"){
      const arr=Array.isArray(v)?v:[];
      (q.options||[]).forEach((o,i)=>{h+="<div style='display:flex;align-items:center;gap:8px;margin:6px 0'><input type='checkbox' id='f_"+q.id+"_"+i+"' data-q='"+q.id+"' value=\\""+esc(o)+"\\""+(arr.indexOf(o)>=0?" checked":"")+dis+" style='width:auto'/><span>"+esc(o)+"</span></div>";});
    } else {
      h+="<input id='f_"+q.id+"' value=\\""+esc(v||"")+"\\""+dis+"/>";
    }
  });
  document.getElementById("qs").innerHTML=h;
}
function readAnswers(){
  const out={};
  (window._q||[]).forEach(q=>{
    if(q.type==="multi"){
      const sel=[];document.querySelectorAll("input[data-q='"+q.id+"']:checked").forEach(el=>sel.push(el.value));
      if(sel.length) out[q.id]=sel;
    } else {
      const el=document.getElementById("f_"+q.id); if(el&&String(el.value).trim()!=="") out[q.id]=el.value;
    }
  });
  return out;
}
async function saveForm(btn){
  const mid=document.getElementById("member").value; if(!mid){alert("Please choose your name.");return;}
  const answers=readAnswers();
  const missing=(window._q||[]).filter(q=>q.required&&(answers[q.id]==null||answers[q.id]===""||(Array.isArray(answers[q.id])&&!answers[q.id].length)));
  if(missing.length){alert("Please answer: "+missing.map(q=>q.label).join(", "));return;}
  const ok=await submit({member_id:mid,answers:answers},btn);
  if(ok){document.getElementById("ok").textContent="Thanks! Your response was submitted.";btn.textContent="Submitted";
    if(!window._abm)window._abm={};window._abm[mid]=answers;}
}
"""
