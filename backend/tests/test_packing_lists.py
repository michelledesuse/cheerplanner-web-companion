"""Backend tests for CheerPlanner packing-list feature (templates + per-comp
lists + per-athlete check states + household sharing + reminders).

Covers all 14 acceptance criteria from the review request.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------- helpers ----------
def _signup():
    email = f"TEST_packing_{uuid.uuid4().hex[:10]}@mailinator.com"
    r = requests.post(
        f"{API}/auth/signup",
        json={"email": email, "password": "Password123!", "name": "Pack Tester"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"], email


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _create_comp(token: str, days_offset: int = 3, name: str = "TEST_Comp") -> dict:
    ev = (datetime.now(timezone.utc).date() + timedelta(days=days_offset)).isoformat()
    r = requests.post(
        f"{API}/competitions",
        headers=_auth(token),
        json={"name": f"{name}_{uuid.uuid4().hex[:6]}", "event_date": ev},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_athlete(token: str, name: str) -> dict:
    r = requests.post(
        f"{API}/athletes",
        headers=_auth(token),
        json={"name": name},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def primary_user():
    token, email = _signup()
    return {"token": token, "email": email}


@pytest.fixture(scope="module")
def secondary_user():
    token, email = _signup()
    return {"token": token, "email": email}


# ---------- 1. seed default template (idempotent) ----------
class TestSeedDefault:
    def test_seed_default_creates_cheerplanner_standard(self, primary_user):
        r = requests.post(
            f"{API}/packing-templates/seed-default",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        tpl = r.json()
        assert tpl["name"] == "CheerPlanner Standard"
        assert tpl["is_default"] is True
        assert len(tpl["items"]) >= 40, f"expected >=40 items, got {len(tpl['items'])}"
        # Verify all 6 categories present
        cats = {it["category"] for it in tpl["items"]}
        for expected in {"Uniform", "Practice Wear", "Hair & Makeup",
                         "Toiletries", "Essentials", "Medication"}:
            assert expected in cats, f"missing category {expected}; got {cats}"
        # Tips populated
        assert isinstance(tpl["tips"], list) and len(tpl["tips"]) >= 1
        # Save id for idempotency check
        primary_user["default_template_id"] = tpl["id"]

    def test_seed_default_is_idempotent(self, primary_user):
        r = requests.post(
            f"{API}/packing-templates/seed-default",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        tpl = r.json()
        # Must return SAME template (same id)
        assert tpl["id"] == primary_user["default_template_id"], "seed-default not idempotent"


# ---------- 2/3/4/5. template CRUD + list ordering ----------
class TestTemplateCRUD:
    def test_create_custom_template(self, primary_user):
        payload = {
            "name": "TEST_Travel Custom",
            "items": [
                {"label": "Passport", "category": "Essentials", "order": 0},
                {"label": "Charger", "category": "Essentials", "order": 1},
            ],
            "tips": ["Pack early", "Double-check uniform"],
        }
        r = requests.post(
            f"{API}/packing-templates",
            headers=_auth(primary_user["token"]), json=payload, timeout=30,
        )
        assert r.status_code == 200, r.text
        tpl = r.json()
        assert tpl["name"] == "TEST_Travel Custom"
        assert len(tpl["items"]) == 2
        assert tpl["is_default"] is False
        assert tpl["tips"] == ["Pack early", "Double-check uniform"]
        primary_user["custom_template_id"] = tpl["id"]

    def test_list_templates_default_first(self, primary_user):
        r = requests.get(
            f"{API}/packing-templates",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        tpls = r.json()
        assert len(tpls) >= 2
        assert tpls[0]["is_default"] is True, "default template should be first"
        assert tpls[0]["name"] == "CheerPlanner Standard"

    def test_patch_template_updates_name_items_tips(self, primary_user):
        tid = primary_user["custom_template_id"]
        r = requests.patch(
            f"{API}/packing-templates/{tid}",
            headers=_auth(primary_user["token"]),
            json={
                "name": "TEST_Travel Custom v2",
                "items": [{"label": "Sunscreen", "category": "Toiletries", "order": 0}],
                "tips": ["new tip"],
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        tpl = r.json()
        assert tpl["name"] == "TEST_Travel Custom v2"
        assert len(tpl["items"]) == 1 and tpl["items"][0]["label"] == "Sunscreen"
        assert tpl["tips"] == ["new tip"]

        # Verify GET reflects update
        r2 = requests.get(
            f"{API}/packing-templates",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        found = next((t for t in r2.json() if t["id"] == tid), None)
        assert found and found["name"] == "TEST_Travel Custom v2"

    def test_delete_template(self, primary_user):
        # Create a throwaway template, delete it, ensure gone
        r = requests.post(
            f"{API}/packing-templates",
            headers=_auth(primary_user["token"]),
            json={"name": "TEST_Throwaway", "items": [], "tips": []},
            timeout=30,
        )
        assert r.status_code == 200
        tid = r.json()["id"]
        d = requests.delete(
            f"{API}/packing-templates/{tid}",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert d.status_code == 200 and d.json().get("deleted") is True
        # Verify
        r2 = requests.get(
            f"{API}/packing-templates",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert all(t["id"] != tid for t in r2.json())


# ---------- 6/7. competition packing-list hydration + GET ----------
class TestPackingListHydration:
    def test_get_returns_null_when_no_list(self, primary_user):
        comp = _create_comp(primary_user["token"], days_offset=20)
        primary_user["comp_far"] = comp
        r = requests.get(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json() in (None, "null") or r.json() is None

    def test_post_with_template_hydrates_items_and_tips(self, primary_user):
        comp = _create_comp(primary_user["token"], days_offset=5, name="TEST_HydrateComp")
        primary_user["comp_close"] = comp
        tid = primary_user["default_template_id"]
        r = requests.post(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]),
            json={"competition_id": comp["id"], "template_id": tid},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        pl = r.json()
        assert pl["template_id"] == tid
        assert len(pl["items"]) >= 40, f"expected >=40 hydrated items, got {len(pl['items'])}"
        assert len(pl["tips"]) >= 1
        # Each item should have label + category + empty checked_by
        for it in pl["items"][:3]:
            assert "label" in it and "category" in it and "checked_by" in it
        primary_user["list_id"] = pl["id"]

    def test_post_with_no_template_id_defaults_items_to_empty(self, primary_user):
        comp = _create_comp(primary_user["token"], days_offset=10, name="TEST_EmptyComp")
        r = requests.post(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]),
            json={"competition_id": comp["id"]},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        pl = r.json()
        assert pl["items"] == []
        assert pl["template_id"] is None

    def test_get_returns_persisted_list(self, primary_user):
        comp = primary_user["comp_close"]
        r = requests.get(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert r.status_code == 200
        pl = r.json()
        assert pl is not None
        assert pl["id"] == primary_user["list_id"]


# ---------- 8/9. PATCH list (items, tips, save_as_template) ----------
class TestPackingListPatch:
    def test_patch_updates_items_and_toggles_checked_by(self, primary_user):
        lid = primary_user["list_id"]
        # Read current
        comp = primary_user["comp_close"]
        r = requests.get(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        pl = r.json()
        items = pl["items"]
        # Add an athlete to create a real key for checked_by
        athlete = _create_athlete(primary_user["token"], "TEST_Athlete_Main")
        primary_user["athlete_main_id"] = athlete["id"]

        # Toggle first item checked, leave others unchecked
        items[0]["checked_by"] = {athlete["id"]: True}
        # Also remove last item (to test removal)
        removed_label = items[-1]["label"]
        new_items = items[:-1]

        r2 = requests.patch(
            f"{API}/packing-lists/{lid}",
            headers=_auth(primary_user["token"]),
            json={"items": new_items, "tips": ["updated tip"]},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        assert len(updated["items"]) == len(items) - 1
        assert updated["tips"] == ["updated tip"]
        # Toggle persisted
        assert updated["items"][0]["checked_by"].get(athlete["id"]) is True
        # Removed item is gone
        assert all(it["label"] != removed_label for it in updated["items"])

    def test_patch_save_as_template_creates_snapshot(self, primary_user):
        lid = primary_user["list_id"]
        snap_name = f"TEST_Snapshot_{uuid.uuid4().hex[:6]}"
        r = requests.patch(
            f"{API}/packing-lists/{lid}",
            headers=_auth(primary_user["token"]),
            json={"save_as_template_name": snap_name},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # Verify a new template with that name exists
        r2 = requests.get(
            f"{API}/packing-templates",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        names = [t["name"] for t in r2.json()]
        assert snap_name in names, f"snapshot template not created. names={names}"
        # And the snapshot must contain items > 0
        snap = next(t for t in r2.json() if t["name"] == snap_name)
        assert len(snap["items"]) > 0


# ---------- 10. delete list ----------
class TestPackingListDelete:
    def test_delete_packing_list(self, primary_user):
        comp = _create_comp(primary_user["token"], days_offset=15, name="TEST_DelComp")
        r = requests.post(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]),
            json={"competition_id": comp["id"]},
            timeout=30,
        )
        lid = r.json()["id"]
        d = requests.delete(
            f"{API}/packing-lists/{lid}",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert d.status_code == 200 and d.json().get("deleted") is True
        g = requests.get(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert g.status_code == 200 and g.json() is None


# ---------- 11/12. reminders ----------
class TestRemindersPacking:
    def test_reminders_include_packing_when_unchecked_within_7_days(self, primary_user):
        comp = primary_user["comp_close"]  # event 5d away
        r = requests.get(f"{API}/reminders", headers=_auth(primary_user["token"]), timeout=30)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        packing_rem = [
            it for it in items
            if it.get("kind") == "packing" and it.get("competition_id") == comp["id"]
        ]
        assert packing_rem, f"expected packing reminder for comp {comp['id']}; items={items}"
        sub = packing_rem[0].get("subtitle", "")
        assert "items left" in sub.lower(), f"subtitle missing 'items left': {sub}"

    def test_reminders_skip_packing_when_all_checked(self, primary_user):
        # Build a fresh competition close-by with an empty list, then add one item checked
        comp = _create_comp(primary_user["token"], days_offset=4, name="TEST_AllChecked")
        athlete_id = primary_user["athlete_main_id"]
        r = requests.post(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]),
            json={
                "competition_id": comp["id"],
                "items": [
                    {
                        "label": "Lone item", "category": "Uniform", "order": 0,
                        "checked_by": {athlete_id: True},
                    }
                ],
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # Now fetch reminders — no packing reminder for this comp
        rem = requests.get(f"{API}/reminders", headers=_auth(primary_user["token"]), timeout=30).json()
        packing_for_comp = [
            it for it in rem.get("items", [])
            if it.get("kind") == "packing" and it.get("competition_id") == comp["id"]
        ]
        assert not packing_for_comp, f"expected NO packing reminder; got {packing_for_comp}"


# ---------- 13. household sharing ----------
class TestHouseholdSharing:
    def test_two_users_share_template_and_list(self, primary_user, secondary_user):
        # Primary creates invite
        r = requests.post(
            f"{API}/household/invite",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        code = r.json()["code"]
        # Secondary joins
        j = requests.post(
            f"{API}/household/join",
            headers=_auth(secondary_user["token"]),
            json={"code": code},
            timeout=30,
        )
        assert j.status_code == 200, j.text
        # Secondary should see primary's templates
        r2 = requests.get(
            f"{API}/packing-templates",
            headers=_auth(secondary_user["token"]), timeout=30,
        )
        assert r2.status_code == 200
        names = [t["name"] for t in r2.json()]
        assert "CheerPlanner Standard" in names, f"household templates not shared. names={names}"
        # Secondary should see primary's comp packing list
        comp = primary_user["comp_close"]
        r3 = requests.get(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(secondary_user["token"]), timeout=30,
        )
        assert r3.status_code == 200, r3.text
        pl = r3.json()
        assert pl is not None and pl["id"] == primary_user["list_id"]
        # Secondary edits the list — should succeed
        new_items = pl["items"] + [{
            "id": str(uuid.uuid4()),
            "label": "TEST_AddedBySecondary",
            "category": "Other",
            "order": 999,
            "checked_by": {},
        }]
        r4 = requests.patch(
            f"{API}/packing-lists/{pl['id']}",
            headers=_auth(secondary_user["token"]),
            json={"items": new_items},
            timeout=30,
        )
        assert r4.status_code == 200, r4.text
        # Primary sees the secondary's edit
        r5 = requests.get(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]), timeout=30,
        )
        labels = [it["label"] for it in r5.json()["items"]]
        assert "TEST_AddedBySecondary" in labels


# ---------- 14. per-athlete checked_by independence ----------
class TestPerAthleteChecks:
    def test_independent_check_states_per_athlete(self, primary_user):
        # Create two athletes + a fresh comp + fresh empty list with one item
        a1 = _create_athlete(primary_user["token"], "TEST_AthletePerCheck_A")
        a2 = _create_athlete(primary_user["token"], "TEST_AthletePerCheck_B")
        comp = _create_comp(primary_user["token"], days_offset=12, name="TEST_PerAthleteComp")
        r = requests.post(
            f"{API}/competitions/{comp['id']}/packing-list",
            headers=_auth(primary_user["token"]),
            json={
                "competition_id": comp["id"],
                "items": [{"label": "Bow", "category": "Uniform", "order": 0,
                           "checked_by": {a1["id"]: True, a2["id"]: False}}],
                "athlete_ids": [a1["id"], a2["id"]],
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        pl = r.json()
        cb = pl["items"][0]["checked_by"]
        assert cb.get(a1["id"]) is True
        assert cb.get(a2["id"]) is False

        # Toggle only a2 to true and confirm a1 unchanged
        items = pl["items"]
        items[0]["checked_by"][a2["id"]] = True
        r2 = requests.patch(
            f"{API}/packing-lists/{pl['id']}",
            headers=_auth(primary_user["token"]),
            json={"items": items},
            timeout=30,
        )
        assert r2.status_code == 200
        cb2 = r2.json()["items"][0]["checked_by"]
        assert cb2.get(a1["id"]) is True and cb2.get(a2["id"]) is True
