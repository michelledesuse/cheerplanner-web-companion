"""One-time cleanup: a skill should appear on only its LOWEST level.

1. Rewrites data/skill_catalog.json keeping, per (category, normalized name),
   the entry with the smallest level_group.
2. Migrates every household's `skills` collection the same way. When a higher-
   level duplicate is removed, any athlete assessment / review tied to it is
   moved onto the kept (lower-level) skill if that skill has none for the
   roster; otherwise the duplicate's row is dropped.

Idempotent — safe to run multiple times.
"""
import asyncio
import json
import os
from collections import defaultdict

from core.db import db

CATALOG = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "skill_catalog.json")


def _norm(s) -> str:
    return " ".join(str(s or "").strip().lower().split())


def dedupe_catalog() -> int:
    cat = json.load(open(CATALOG))
    best = {}
    for s in cat:
        key = (s["category"], _norm(s["name"]))
        cur = best.get(key)
        if cur is None or int(s.get("level_group") or 1) < int(cur.get("level_group") or 1):
            best[key] = s
    kept = list(best.values())
    kept.sort(key=lambda s: (s["category"], int(s.get("level_group") or 1), int(s.get("order") or 0)))
    removed = len(cat) - len(kept)
    with open(CATALOG, "w") as f:
        json.dump(kept, f, indent=0)
    print(f"catalog: {len(cat)} -> {len(kept)} ({removed} removed)")
    return removed


async def dedupe_households() -> None:
    hids = await db.skills.distinct("household_id")
    for hid in hids:
        skills = await db.skills.find({"household_id": hid}, {"_id": 0}).to_list(5000)
        groups = defaultdict(list)
        for s in skills:
            groups[(s.get("category"), _norm(s.get("name")))].append(s)
        removed = 0
        for _, rows in groups.items():
            if len(rows) < 2:
                continue
            rows.sort(key=lambda s: (int(s.get("level_group") or 1), int(s.get("order") or 0)))
            keep = rows[0]
            for dup in rows[1:]:
                # Move assessments/reviews onto the kept skill when it has none.
                async for a in db.athlete_skills.find({"household_id": hid, "skill_id": dup["id"]}, {"_id": 0}):
                    exists = await db.athlete_skills.find_one(
                        {"household_id": hid, "skill_id": keep["id"], "roster_id": a["roster_id"]}, {"_id": 0, "id": 1}
                    )
                    if exists:
                        await db.athlete_skills.delete_one({"household_id": hid, "skill_id": dup["id"], "roster_id": a["roster_id"]})
                    else:
                        await db.athlete_skills.update_one(
                            {"household_id": hid, "skill_id": dup["id"], "roster_id": a["roster_id"]},
                            {"$set": {"skill_id": keep["id"]}},
                        )
                await db.skill_reviews.update_many(
                    {"household_id": hid, "skill_id": dup["id"]}, {"$set": {"skill_id": keep["id"]}}
                )
                await db.skills.delete_one({"id": dup["id"], "household_id": hid})
                removed += 1
        if removed:
            print(f"household {hid}: removed {removed} duplicate skill rows")


async def main():
    dedupe_catalog()
    await dedupe_households()
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
