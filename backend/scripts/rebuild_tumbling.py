"""Replace the Tumbling catalog with the coach-provided Standing/Running list.

- Adds `sub_category` ("standing" | "running") to tumbling skills.
- Applies the no-repeat rule PER sub-category (a skill may appear once as
  Standing and once as Running; otherwise it stays only on its lowest level).
- Keeps Stunting & Jumps untouched (sub_category="").
- Rewrites data/skill_catalog.json and migrates every household's tumbling
  skills, matching by name to preserve existing athlete assessments.
"""
import asyncio
import json
import os
from collections import defaultdict

from core.db import db

CATALOG = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "skill_catalog.json")

# level -> {"standing": [...], "running": [...]}  (verbatim from the coach)
TUMBLING = {
    1: {
        "standing": ["Forward roll", "Backward roll", "Handstand", "Handstand forward roll", "Front walkover", "Back walkover"],
        "running": ["Cartwheel", "Round-off", "Cartwheel–cartwheel", "Cartwheel–round-off", "Round-off–rebound", "Front walkover–round-off"],
    },
    2: {
        "standing": ["Standing back handspring", "Standing back handspring series", "Back walkover–back handspring", "Back handspring step-out", "Back handspring step-out–back handspring"],
        "running": ["Dive roll", "Round-off back handspring", "Round-off back handspring step-out", "Round-off back handspring series", "Front walkover–round-off back handspring", "Cartwheel–back handspring"],
    },
    3: {
        "standing": ["Standing back handspring–back tuck", "Standing back handspring series–back tuck", "Standing back tuck", "Back handspring step-out–back tuck"],
        "running": ["Round-off back handspring–back tuck", "Round-off back handspring series–back tuck", "Front tuck", "Punch front", "Aerial", "Front walkover–round-off back handspring–back tuck"],
    },
    4: {
        "standing": ["Standing back handspring–layout", "Standing back handspring series–layout", "Standing back tuck–back handspring", "Standing back tuck–back tuck"],
        "running": ["Round-off back handspring–layout", "Round-off back handspring series–layout", "Punch front–step-out", "Punch front–back tuck", "Aerial–back handspring", "Specialty pass to layout"],
    },
    5: {
        "standing": ["Standing back handspring–full", "Standing back handspring series–full", "Standing back tuck–full", "Standing back handspring–back tuck–full"],
        "running": ["Round-off back handspring–full", "Round-off back handspring series–full", "Punch front–full", "Layout step-out–full", "Front handspring step-out–full", "Specialty pass to full"],
    },
    6: {
        "standing": ["Standing full", "Standing back handspring–full", "Standing back handspring series–full", "Standing back tuck–full"],
        "running": ["Round-off back handspring–back handspring–double full", "Round-off back handspring series–double full", "Punch front–double full", "Whip–double full", "Specialty pass to double full"],
    },
    7: {
        "standing": ["Standing double full", "Standing back handspring–double full", "Standing back tuck–double full", "Standing full–back tuck", "Standing full–full"],
        "running": ["Round-off back handspring–double full", "Round-off–double full", "Punch front–double full", "Whip–double full", "Specialty pass to double full", "Advanced connected twisting passes"],
    },
}


def _norm(s) -> str:
    return " ".join(str(s or "").strip().lower().split())


def build_tumbling():
    """Return deduped tumbling entries: keep each (sub_category, name) on lowest level."""
    seen = {}  # (sub, norm_name) -> entry
    for lvl in sorted(TUMBLING):
        for sub in ("standing", "running"):
            for i, name in enumerate(TUMBLING[lvl][sub]):
                key = (sub, _norm(name))
                if key in seen:
                    continue  # already on a lower level -> skip (no-repeat rule)
                seen[key] = {"category": "tumbling", "sub_category": sub,
                             "level_group": lvl, "name": name, "order": i}
    # Re-number order within each (level, sub) after dedupe
    by_ls = defaultdict(list)
    for e in seen.values():
        by_ls[(e["level_group"], e["sub_category"])].append(e)
    out = []
    for (lvl, sub) in sorted(by_ls, key=lambda k: (k[0], 0 if k[1] == "standing" else 1)):
        for i, e in enumerate(by_ls[(lvl, sub)]):
            e["order"] = i
            out.append(e)
    return out


def rebuild_catalog(tumbling):
    cat = json.load(open(CATALOG))
    others = []
    for s in cat:
        if s.get("category") == "tumbling":
            continue
        s.setdefault("sub_category", "")
        others.append(s)
    new = others + tumbling
    with open(CATALOG, "w") as f:
        json.dump(new, f, indent=0)
    print(f"catalog: tumbling {sum(1 for s in cat if s.get('category')=='tumbling')} -> {len(tumbling)}; total {len(cat)} -> {len(new)}")


async def migrate_households(tumbling):
    hids = await db.skills.distinct("household_id")
    for hid in hids:
        old = await db.skills.find({"household_id": hid, "category": "tumbling"}, {"_id": 0}).to_list(5000)
        old_by_name = defaultdict(list)
        for o in old:
            old_by_name[_norm(o["name"])].append(o)
        used = set()
        for e in tumbling:
            cands = old_by_name.get(_norm(e["name"]), [])
            reuse = next((o for o in cands if o["id"] not in used), None)
            if reuse:
                used.add(reuse["id"])
                await db.skills.update_one(
                    {"id": reuse["id"], "household_id": hid},
                    {"$set": {"level_group": e["level_group"], "sub_category": e["sub_category"],
                              "order": e["order"], "name": e["name"]}},
                )
            else:
                import uuid as _uuid
                from datetime import datetime, timezone
                await db.skills.insert_one({
                    "id": str(_uuid.uuid4()), "household_id": hid, "category": "tumbling",
                    "sub_category": e["sub_category"], "level_group": e["level_group"],
                    "name": e["name"], "order": e["order"],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
        # Remove leftover old tumbling skills no longer in the list (+ their data)
        removed = 0
        for o in old:
            if o["id"] not in used:
                await db.skills.delete_one({"id": o["id"], "household_id": hid})
                await db.athlete_skills.delete_many({"household_id": hid, "skill_id": o["id"]})
                await db.skill_reviews.delete_many({"household_id": hid, "skill_id": o["id"]})
                removed += 1
        # Ensure stunting/jumps carry an explicit sub_category="" for consistency
        await db.skills.update_many(
            {"household_id": hid, "category": {"$in": ["stunting", "jumps"]}, "sub_category": {"$exists": False}},
            {"$set": {"sub_category": ""}},
        )
        print(f"household {hid}: tumbling now {len([e for e in tumbling])}, removed {removed} stale")


async def main():
    tumbling = build_tumbling()
    print(f"built {len(tumbling)} tumbling skills (deduped per sub-category)")
    rebuild_catalog(tumbling)
    await migrate_households(tumbling)
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
