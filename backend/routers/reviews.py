"""Community Reviews — a GLOBAL, cross-account directory of cheer-friendly
places (restaurants, hotels, gyms, etc.) that every CheerPlanner user can read
and contribute to, independent of households/teams.

Any authenticated user can:
  - browse places (filter by category + city, search, sort),
  - view a place with all its reviews,
  - add/edit/delete their OWN review (one review per user per place),
  - add a new category,
  - report/flag a review for moderation.

Admins (ADMIN_EMAILS) additionally can:
  - merge (combine) two duplicate places into one,
  - delete any review,
  - manage categories (rename / delete -> reassign to "Other"),
  - view flagged reviews.

Aggregates (avg_rating, review_count) are stored on the place doc and recomputed
from the review rows (source of truth) after every mutation.
"""
import re
import secrets
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field

from core.db import db
from core.models import utcnow_iso
from core.security import get_current_user, require_admin

router = APIRouter(prefix="/api")

DEFAULT_CATEGORIES = [
    "Restaurants/Eateries", "Coffee Shops", "Hotels/Lodging", "Things to Do",
    "Gyms/Practice Facilities", "Shopping/Malls", "Hair & Makeup Artists",
    "Hairpieces", "Makeup", "Training Programs", "Competitions", "Other",
]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _display_name(user: dict, mode: str) -> str:
    """Snapshot the reviewer's public display name at write time."""
    if mode == "anonymous":
        return "Anonymous"
    raw = (user.get("name") or "").strip()
    if not raw:
        raw = (user.get("email") or "").split("@")[0]
    parts = [p for p in raw.split() if p]
    if not parts:
        return "Anonymous"
    if len(parts) == 1:
        return parts[0][:30]
    return f"{parts[0]} {parts[-1][0].upper()}."[:40]


# Objectionable-content filter (Apple Guideline 1.2). Substring match on word
# boundaries; deliberately conservative to avoid false positives.
_BANNED = [
    "fuck", "shit", "bitch", "asshole", "cunt", "nigger", "nigga", "faggot",
    "fag", "retard", "whore", "slut", "rape", "dick", "pussy", "cock",
    "kill yourself", "kys",
]
_BANNED_RE = re.compile(r"(?i)(" + "|".join(re.escape(w) for w in _BANNED) + r")")
FLAG_HIDE_THRESHOLD = 3  # distinct reports before a review is auto-hidden


def _assert_clean(*parts: str):
    for p in parts:
        if p and _BANNED_RE.search(p):
            raise HTTPException(status_code=400, detail="Your text contains language that isn't allowed. Please revise and try again.")


async def _require_guidelines(user_id: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "reviews_guidelines_accepted_at": 1})
    if not (u or {}).get("reviews_guidelines_accepted_at"):
        raise HTTPException(status_code=403, detail="guidelines_not_accepted")


async def _blocked_author_ids(user_id: str) -> set:
    rows = await db.review_blocks.find({"user_id": user_id}, {"_id": 0, "blocked_user_id": 1}).to_list(5000)
    return {r["blocked_user_id"] for r in rows}


async def _recompute_place(place_id: str):
    """Recompute avg_rating + review_count on a place from its review rows."""
    rows = await db.place_reviews.find({"place_id": place_id}, {"_id": 0, "rating": 1}).to_list(100000)
    count = len(rows)
    avg = round(sum(int(r.get("rating") or 0) for r in rows) / count, 2) if count else 0.0
    await db.review_places.update_one(
        {"id": place_id}, {"$set": {"avg_rating": avg, "review_count": count, "updated_at": utcnow_iso()}}
    )
    return avg, count


async def seed_review_categories():
    """Idempotently ensure the default category set exists."""
    for label in DEFAULT_CATEGORIES:
        await db.review_categories.update_one(
            {"label_norm": _norm(label)},
            {"$setOnInsert": {
                "id": secrets.token_urlsafe(9), "label": label, "label_norm": _norm(label),
                "is_default": True, "created_by": None, "created_at": utcnow_iso(),
            }},
            upsert=True,
        )


async def _ensure_category(label: str, user_id: Optional[str]) -> str:
    """Find or create a category, returning its canonical label."""
    label = (label or "").strip()[:60] or "Other"
    existing = await db.review_categories.find_one({"label_norm": _norm(label)}, {"_id": 0, "label": 1})
    if existing:
        return existing["label"]
    await db.review_categories.insert_one({
        "id": secrets.token_urlsafe(9), "label": label, "label_norm": _norm(label),
        "is_default": False, "created_by": user_id, "created_at": utcnow_iso(),
    })
    return label


# ---------- payloads ----------
class ReviewSubmit(BaseModel):
    place_id: Optional[str] = None          # target an existing place, else find/create by name+city
    place_name: str = ""
    city: str = ""
    category: str = "Other"
    rating: int = Field(..., ge=1, le=5)
    body: str = ""
    display_mode: Literal["anonymous", "name"] = "name"
    photos: Optional[List[str]] = None      # up to 3 base64 data-URL images


class ReviewEdit(BaseModel):
    rating: Optional[int] = Field(None, ge=1, le=5)
    body: Optional[str] = None
    display_mode: Optional[Literal["anonymous", "name"]] = None
    photos: Optional[List[str]] = None


class CategoryCreate(BaseModel):
    label: str


class CategoryRename(BaseModel):
    label: str


class MergePayload(BaseModel):
    source_id: str


class FlagPayload(BaseModel):
    reason: str = ""


# ---------- categories ----------
@router.get("/reviews/categories")
async def list_categories(current_user=Depends(get_current_user)):
    cats = await db.review_categories.find({}, {"_id": 0}).to_list(500)
    raw = await db.review_places.aggregate([{"$group": {"_id": "$category", "n": {"$sum": 1}}}]).to_list(1000)
    counts = {r["_id"]: r["n"] for r in raw}
    for c in cats:
        c["place_count"] = int(counts.get(c["label"], 0))
    order = {label: i for i, label in enumerate(DEFAULT_CATEGORIES)}
    cats.sort(key=lambda c: (0 if c.get("is_default") else 1, order.get(c["label"], 999), c["label"].lower()))
    u = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "reviews_guidelines_accepted_at": 1})
    return {
        "categories": cats,
        "is_admin": bool(current_user.get("is_admin")),
        "guidelines_accepted": bool((u or {}).get("reviews_guidelines_accepted_at")),
    }


@router.post("/reviews/accept-guidelines")
async def accept_guidelines(current_user=Depends(get_current_user)):
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"reviews_guidelines_accepted_at": utcnow_iso()}})
    return {"accepted": True}


@router.post("/reviews/{review_id}/block")
async def block_review_author(review_id: str, current_user=Depends(get_current_user)):
    """Hide all content from a review's author for the requesting user, and
    prevent that author's content from appearing to them going forward."""
    r = await db.place_reviews.find_one({"id": review_id}, {"_id": 0, "user_id": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    if r["user_id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="You can't block yourself.")
    await db.review_blocks.update_one(
        {"user_id": current_user["id"], "blocked_user_id": r["user_id"]},
        {"$set": {"created_at": utcnow_iso()}}, upsert=True,
    )
    return {"blocked": True}


@router.post("/reviews/categories")
async def add_category(payload: CategoryCreate, current_user=Depends(get_current_user)):
    label = (payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Please enter a category name.")
    _assert_clean(label)
    canonical = await _ensure_category(label, current_user["id"])
    return {"label": canonical}


@router.patch("/reviews/categories/{cat_id}", dependencies=[Depends(require_admin)])
async def rename_category(cat_id: str, payload: CategoryRename):
    cat = await db.review_categories.find_one({"id": cat_id}, {"_id": 0})
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    new_label = (payload.label or "").strip()[:60]
    if not new_label:
        raise HTTPException(status_code=400, detail="Category name can't be empty.")
    old_label = cat["label"]
    await db.review_categories.update_one({"id": cat_id}, {"$set": {"label": new_label, "label_norm": _norm(new_label)}})
    # move places over to the new label
    await db.review_places.update_many({"category": old_label}, {"$set": {"category": new_label}})
    return {"id": cat_id, "label": new_label}


@router.delete("/reviews/categories/{cat_id}", dependencies=[Depends(require_admin)])
async def delete_category(cat_id: str):
    cat = await db.review_categories.find_one({"id": cat_id}, {"_id": 0})
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if cat.get("label") == "Other":
        raise HTTPException(status_code=400, detail="The 'Other' category can't be deleted.")
    await _ensure_category("Other", None)
    await db.review_places.update_many({"category": cat["label"]}, {"$set": {"category": "Other"}})
    await db.review_categories.delete_one({"id": cat_id})
    return {"deleted": True}


# ---------- places ----------
@router.get("/reviews/places")
async def list_places(
    current_user=Depends(get_current_user),
    category: Optional[str] = None,
    city: Optional[str] = None,
    q: Optional[str] = None,
    sort: str = Query("top", pattern="^(top|reviews|new)$"),
):
    query: dict = {}
    if category and category != "all":
        query["category"] = category
    if city:
        query["city"] = {"$regex": re.escape(city.strip()), "$options": "i"}
    if q:
        query["name"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    places = await db.review_places.find(query, {"_id": 0}).to_list(2000)
    if sort == "reviews":
        places.sort(key=lambda p: (-int(p.get("review_count") or 0), -(p.get("avg_rating") or 0)))
    elif sort == "new":
        places.sort(key=lambda p: p.get("created_at", ""), reverse=True)
    else:  # top rated (with at least the review), then by count
        places.sort(key=lambda p: (-(p.get("avg_rating") or 0), -int(p.get("review_count") or 0)))
    return {"places": places}


@router.get("/reviews/near")
async def places_near_competition(competition_id: str, current_user=Depends(get_current_user)):
    """Suggest reviewed places in the city of a given competition.

    We derive candidate location terms from the competition's `location` and
    `address` free-text, then match review places whose `city` contains any of
    them (case-insensitive). Best-effort — this powers a soft "nearby" section.
    """
    comp = await db.competitions.find_one({"id": competition_id}, {"_id": 0, "location": 1, "address": 1})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    text = " ".join([str(comp.get("location") or ""), str(comp.get("address") or "")]).strip()
    if not text:
        return {"location": None, "places": []}

    STOP = {"resort", "hotel", "center", "centre", "arena", "convention", "the", "and",
            "expo", "complex", "stadium", "usa", "inc", "llc", "suite", "ste", "blvd",
            "road", "rd", "street", "st", "ave", "avenue", "dr", "drive", "lane", "ln"}
    US_STATES = set("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt "
                    "ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy".split())
    terms = set()
    for part in re.split(r"[,\n]", text):
        p = part.strip()
        if len(p) >= 3 and p.lower() not in STOP and p.lower() not in US_STATES and not p.isdigit():
            terms.add(p)
    for w in re.findall(r"[A-Za-z]{3,}", text):
        if w.lower() not in STOP and w.lower() not in US_STATES:
            terms.add(w)
    terms = {t for t in terms if len(t) >= 3}
    if not terms:
        return {"location": text, "places": []}

    or_clauses = [{"city": {"$regex": re.escape(t), "$options": "i"}} for t in terms]
    places = await db.review_places.find({"$or": or_clauses}, {"_id": 0}).to_list(300)
    places.sort(key=lambda p: (-(p.get("avg_rating") or 0), -int(p.get("review_count") or 0)))
    return {"location": text, "places": places[:12]}


@router.get("/reviews/places/{place_id}")
async def place_detail(place_id: str, current_user=Depends(get_current_user)):
    place = await db.review_places.find_one({"id": place_id}, {"_id": 0})
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")
    reviews = await db.place_reviews.find({"place_id": place_id}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    is_admin = bool(current_user.get("is_admin"))
    blocked = await _blocked_author_ids(current_user["id"])
    my_review = None
    visible = []
    for r in reviews:
        mine = r.get("user_id") == current_user["id"]
        author = r.get("user_id")
        r["is_mine"] = mine
        r.pop("user_id", None)
        if mine:
            my_review = r
            visible.append(r)
            continue
        if author in blocked:
            continue  # user blocked this author
        if r.get("hidden") and not is_admin:
            continue  # auto-hidden after reports
        visible.append(r)
    return {
        "place": place,
        "reviews": visible,
        "my_review": my_review,
        "is_admin": is_admin,
    }


# ---------- submit / edit / delete a review ----------
@router.post("/reviews")
async def submit_review(payload: ReviewSubmit, current_user=Depends(get_current_user)):
    await _require_guidelines(current_user["id"])
    _assert_clean(payload.place_name, payload.city, payload.category, payload.body)
    # Resolve or create the target place.
    place = None
    if payload.place_id:
        place = await db.review_places.find_one({"id": payload.place_id}, {"_id": 0})
        if not place:
            raise HTTPException(status_code=404, detail="Place not found")
    else:
        name = (payload.place_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Please enter the place name.")
        city = (payload.city or "").strip()
        category = await _ensure_category(payload.category, current_user["id"])
        name_norm = _norm(name)
        city_norm = _norm(city)
        place = await db.review_places.find_one({"name_norm": name_norm, "city_norm": city_norm}, {"_id": 0})
        if not place:
            place = {
                "id": secrets.token_urlsafe(9),
                "name": name[:120], "name_norm": name_norm,
                "city": city[:80], "city_norm": city_norm,
                "category": category,
                "avg_rating": 0.0, "review_count": 0,
                "created_by": current_user["id"],
                "created_at": utcnow_iso(), "updated_at": utcnow_iso(),
            }
            await db.review_places.insert_one({**place})

    display_name = _display_name(current_user, payload.display_mode)
    photos = [p for p in (payload.photos or []) if isinstance(p, str) and p][:3]
    now = utcnow_iso()
    existing = await db.place_reviews.find_one({"place_id": place["id"], "user_id": current_user["id"]}, {"_id": 0, "id": 1})
    if existing:
        await db.place_reviews.update_one(
            {"id": existing["id"]},
            {"$set": {
                "rating": payload.rating, "body": (payload.body or "").strip()[:2000],
                "display_mode": payload.display_mode, "author_name": display_name,
                "photos": photos, "updated_at": now,
            }},
        )
        review_id = existing["id"]
    else:
        review_id = secrets.token_urlsafe(9)
        await db.place_reviews.insert_one({
            "id": review_id, "place_id": place["id"], "user_id": current_user["id"],
            "rating": payload.rating, "body": (payload.body or "").strip()[:2000],
            "display_mode": payload.display_mode, "author_name": display_name,
            "photos": photos, "created_at": now, "updated_at": now,
        })
    await _recompute_place(place["id"])
    return {"place_id": place["id"], "review_id": review_id}


@router.patch("/reviews/{review_id}")
async def edit_review(review_id: str, payload: ReviewEdit, current_user=Depends(get_current_user)):
    r = await db.place_reviews.find_one({"id": review_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    if r.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own review.")
    updates: dict = {"updated_at": utcnow_iso()}
    if payload.body is not None:
        _assert_clean(payload.body)
    if payload.rating is not None:
        updates["rating"] = payload.rating
    if payload.body is not None:
        updates["body"] = payload.body.strip()[:2000]
    if payload.display_mode is not None:
        updates["display_mode"] = payload.display_mode
        updates["author_name"] = _display_name(current_user, payload.display_mode)
    if payload.photos is not None:
        updates["photos"] = [p for p in payload.photos if isinstance(p, str) and p][:3]
    await db.place_reviews.update_one({"id": review_id}, {"$set": updates})
    await _recompute_place(r["place_id"])
    return {"updated": True}


@router.delete("/reviews/{review_id}")
async def delete_review(review_id: str, current_user=Depends(get_current_user)):
    r = await db.place_reviews.find_one({"id": review_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    if r.get("user_id") != current_user["id"] and not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="You can only delete your own review.")
    await db.place_reviews.delete_one({"id": review_id})
    await db.review_flags.delete_many({"review_id": review_id})
    _, count = await _recompute_place(r["place_id"])
    # if the place has no reviews left, remove it so the directory stays clean
    if count == 0:
        await db.review_places.delete_one({"id": r["place_id"]})
    return {"deleted": True}


# ---------- flag / report ----------
@router.post("/reviews/{review_id}/flag")
async def flag_review(review_id: str, payload: FlagPayload, background: BackgroundTasks, current_user=Depends(get_current_user)):
    from core.email import send_flag_alert
    r = await db.place_reviews.find_one({"id": review_id}, {"_id": 0, "id": 1, "body": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    await db.review_flags.update_one(
        {"review_id": review_id, "user_id": current_user["id"]},
        {"$set": {"reason": (payload.reason or "").strip()[:300], "created_at": utcnow_iso()},
         "$setOnInsert": {"id": secrets.token_urlsafe(9)}},
        upsert=True,
    )
    # Auto-hide from public view once enough distinct users report it.
    n = await db.review_flags.count_documents({"review_id": review_id})
    hidden = n >= FLAG_HIDE_THRESHOLD
    if hidden:
        await db.place_reviews.update_one({"id": review_id}, {"$set": {"hidden": True}})
    background.add_task(send_flag_alert, "review", r.get("body") or "", (payload.reason or ""), n, hidden)
    return {"flagged": True}


@router.get("/reviews/flags", dependencies=[Depends(require_admin)])
async def list_flags():
    flags = await db.review_flags.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # attach the flagged review + place for admin context
    out = []
    for f in flags:
        rev = await db.place_reviews.find_one({"id": f["review_id"]}, {"_id": 0})
        if not rev:
            continue
        place = await db.review_places.find_one({"id": rev["place_id"]}, {"_id": 0, "name": 1, "city": 1})
        rev.pop("user_id", None)
        out.append({"flag": f, "review": rev, "place": place})
    return {"flags": out}


# ---------- admin merge ----------
@router.post("/reviews/places/{target_id}/merge", dependencies=[Depends(require_admin)])
async def merge_places(target_id: str, payload: MergePayload):
    """Merge `source_id` INTO `target_id`: move reviews (keeping the target's
    review if the same user reviewed both), recompute aggregates, delete source."""
    source_id = payload.source_id
    if source_id == target_id:
        raise HTTPException(status_code=400, detail="Can't merge a place into itself.")
    target = await db.review_places.find_one({"id": target_id}, {"_id": 0, "id": 1})
    source = await db.review_places.find_one({"id": source_id}, {"_id": 0, "id": 1})
    if not target or not source:
        raise HTTPException(status_code=404, detail="Place not found")

    tgt_users = {r["user_id"] async for r in db.place_reviews.find({"place_id": target_id}, {"_id": 0, "user_id": 1})}
    src_reviews = await db.place_reviews.find({"place_id": source_id}, {"_id": 0}).to_list(100000)
    dropped_ids = []
    for r in src_reviews:
        if r.get("user_id") in tgt_users:
            # same reviewer already reviewed target -> drop the duplicate source row
            await db.place_reviews.delete_one({"id": r["id"]})
            dropped_ids.append(r["id"])
        else:
            await db.place_reviews.update_one({"id": r["id"]}, {"$set": {"place_id": target_id}})
    if dropped_ids:
        # clean up any flags that pointed at the removed duplicate reviews
        await db.review_flags.delete_many({"review_id": {"$in": dropped_ids}})
    await db.review_places.delete_one({"id": source_id})
    avg, count = await _recompute_place(target_id)
    return {"merged": True, "target_id": target_id, "avg_rating": avg, "review_count": count}
