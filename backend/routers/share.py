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

router = APIRouter(prefix="/api")


def _norm(s) -> str:
    return " ".join(str(s or "").strip().lower().split())


# ============================================================
# Authed management (team personnel)
# ============================================================
@router.post("/team/share", dependencies=[Depends(require_team_access)])
async def create_share(payload: ShareLinkCreate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    if payload.kind == "signup":
        if not payload.ref_id:
            raise HTTPException(status_code=400, detail="ref_id (sheet) required")
        sheet = await db.signup_sheets.find_one({"id": payload.ref_id, "user_id": {"$in": member_ids}}, {"_id": 0, "id": 1})
        if not sheet:
            raise HTTPException(status_code=404, detail="Sign-up sheet not found")
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
    if link["kind"] == "roster":
        doc = await _size_sheet(member_ids)
        cols = sorted(doc.get("columns") or [], key=lambda c: c.get("order", 0))
        return {"kind": "roster", "title": "Team Roster",
                "size_columns": [{"id": c["id"], "label": c["label"]} for c in cols]}
    if link["kind"] == "sizes":
        doc = await _size_sheet(member_ids)
        cols = sorted(doc.get("columns") or [], key=lambda c: c.get("order", 0))
        members = []
        async for m in db.roster.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1}):
            members.append({"id": m["id"], "name": m.get("name")})
        members.sort(key=lambda m: (m["name"] or "").lower())
        return {"kind": "sizes", "title": "Team Sizes",
                "columns": [{"id": c["id"], "label": c["label"]} for c in cols], "members": members}
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

    if link["kind"] == "roster":
        first = (payload.get("first_name") or "").strip()
        last = (payload.get("last_name") or "").strip()
        name = f"{first} {last}".strip()
        if not name:
            raise HTTPException(status_code=400, detail="Please enter a first and last name.")
        role = payload.get("role") if payload.get("role") in ("athlete", "parent", "coach", "team_rep", "staff") else "athlete"
        # Upsert by name within the household.
        match = None
        async for m in db.roster.find({"user_id": {"$in": member_ids}}, {"_id": 0, "id": 1, "name": 1}):
            if _norm(m.get("name")) == _norm(name):
                match = m
                break
        fields = {
            "first_name": first or None, "last_name": last or None, "role": role,
            "phone": (payload.get("phone") or "").strip() or None,
            "email": (payload.get("email") or "").strip() or None,
            "parent_first_name": (payload.get("parent_first_name") or "").strip() or None,
            "parent_last_name": (payload.get("parent_last_name") or "").strip() or None,
            "parent_phone": (payload.get("parent_phone") or "").strip() or None,
            "parent_email": (payload.get("parent_email") or "").strip() or None,
            "notes": (payload.get("notes") or "").strip() or None,
        }
        if match:
            member_id = match["id"]
            upd = {k: v for k, v in fields.items() if v}
            if upd:
                await db.roster.update_one({"id": match["id"]}, {"$set": upd})
        else:
            m = RosterMember(user_id=link["user_id"], name=name, **{k: v for k, v in fields.items() if v is not None})
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
  if(KIND==="roster") return renderRoster(d);
  if(KIND==="sizes") return renderSizes(d);
}}
{_JS_SIGNUP}
{_JS_ROSTER}
{_JS_SIZES}
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
  let h="<h1>"+esc(d.title)+"</h1><p class='sub'>Add your info</p>";
  h+="<div class='row'><div><label>First name</label><input id='first'/></div><div><label>Last name</label><input id='last'/></div></div>";
  h+="<label>Role</label><select id='role'><option value='athlete'>Athlete</option><option value='parent'>Parent</option><option value='coach'>Coach</option><option value='team_rep'>Team Rep</option><option value='staff'>Staff</option></select>";
  h+="<label>Phone</label><input id='phone'/><label>Email</label><input id='email'/>";
  h+="<label>Parent/Guardian first name</label><input id='pfirst'/><label>Parent/Guardian last name</label><input id='plast'/>";
  h+="<label>Parent phone</label><input id='pphone'/><label>Parent email</label><input id='pemail'/>";
  window._szcols=(d.size_columns||[]).map(c=>c.id);
  if((d.size_columns||[]).length){
    h+="<div style='margin-top:14px;font-weight:700;color:#0F172A'>Sizes</div>";
    (d.size_columns||[]).forEach(c=>{h+="<label>"+esc(c.label)+"</label><input id='sz_"+c.id+"'/>";});
  }
  h+="<button onclick='saveRoster(this)'>Submit</button><div class='ok' id='ok'></div>";
  document.getElementById("app").innerHTML="<div class='card'>"+h+"</div>";
  document.getElementById("app").className="";
}
async function saveRoster(btn){
  const g=id=>document.getElementById(id).value;
  if(!g('first').trim()||!g('last').trim()){alert("Please enter a first and last name.");return;}
  const sizes={}; (window._szcols||[]).forEach(id=>{const el=document.getElementById("sz_"+id); if(el) sizes[id]=el.value;});
  const ok=await submit({first_name:g('first'),last_name:g('last'),role:g('role'),phone:g('phone'),email:g('email'),
    parent_first_name:g('pfirst'),parent_last_name:g('plast'),parent_phone:g('pphone'),parent_email:g('pemail'),sizes:sizes},btn);
  if(ok){document.getElementById("ok").textContent="Thanks! Your info was submitted.";btn.textContent="Submitted";}
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
