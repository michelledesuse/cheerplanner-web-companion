"""Iter68 — Team Hub features (P0 To-Dos, P1 signups reorder + attendance +
event/signup linkage, P2 expanded roster + custom columns, P2 blocks).

Backend-only coverage against the public preview URL. Tests use the
applereview account (team_access=true, solo owner).
"""
import os
import time
import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or _env.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def state(hdr):
    """Shared roster (2 athletes + 1 parent) + schedule event + competition for tests."""
    created = {"roster": [], "signups": [], "todos": [], "attendance": [], "columns": [],
               "events": [], "competitions": []}

    # Roster (2 athletes for attendance, 1 parent to verify exclusion)
    for nm, role in (("TEST_iter68_ATH1", "athlete"), ("TEST_iter68_ATH2", "athlete"),
                     ("TEST_iter68_PAR", "parent")):
        r = requests.post(f"{BASE_URL}/api/roster",
                          json={"name": nm, "role": role}, headers=hdr)
        assert r.status_code in (200, 201), r.text
        created["roster"].append(r.json()["id"])

    # Schedule event (for event-scoped todos and signup linkage)
    r = requests.post(f"{BASE_URL}/api/schedule",
                      json={"title": "TEST_iter68_event", "date": "2026-06-01"}, headers=hdr)
    assert r.status_code in (200, 201), r.text
    ev_body = r.json()
    ev = ev_body[0] if isinstance(ev_body, list) else ev_body
    created["events"].append(ev["id"])

    # Competition (for comp-scoped todos)
    r = requests.post(f"{BASE_URL}/api/competitions",
                      json={"name": "TEST_iter68_comp", "event_date": "2026-06-15"}, headers=hdr)
    assert r.status_code in (200, 201), r.text
    created["competitions"].append(r.json()["id"])

    yield {"hdr": hdr, "created": created}

    # Teardown
    for tid in created["todos"]:
        requests.delete(f"{BASE_URL}/api/todos/{tid}", headers=hdr)
    for sid in created["signups"]:
        requests.delete(f"{BASE_URL}/api/team/signups/{sid}", headers=hdr)
    for sid in created["attendance"]:
        requests.delete(f"{BASE_URL}/api/team/attendance/{sid}", headers=hdr)
    for cid in created["columns"]:
        requests.delete(f"{BASE_URL}/api/roster/columns/{cid}", headers=hdr)
    for eid in created["events"]:
        requests.delete(f"{BASE_URL}/api/schedule/{eid}", headers=hdr)
    for cid in created["competitions"]:
        requests.delete(f"{BASE_URL}/api/competitions/{cid}", headers=hdr)
    for mid in created["roster"]:
        requests.delete(f"{BASE_URL}/api/roster/{mid}", headers=hdr)


# ============================================================
# P0 — To-Do lists (team / competition / event scopes)
# ============================================================
class TestTodos:
    def test_team_scope_create_toggle_delete_and_sort(self, state):
        hdr, created = state["hdr"], state["created"]

        # Create 3 todos
        ids = []
        for i, txt in enumerate(["TEST_iter68_todo_A", "TEST_iter68_todo_B", "TEST_iter68_todo_C"]):
            r = requests.post(f"{BASE_URL}/api/todos", json={"text": txt, "scope": "team"}, headers=hdr)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["text"] == txt
            assert body["scope"] == "team"
            assert body["ref_id"] is None
            assert body["done"] is False
            ids.append(body["id"])
            created["todos"].append(body["id"])
            time.sleep(0.02)  # ensure order strings differ

        # List — should include all three
        r = requests.get(f"{BASE_URL}/api/todos?scope=team", headers=hdr)
        assert r.status_code == 200
        texts = [t["text"] for t in r.json() if t["id"] in ids]
        assert set(texts) == {"TEST_iter68_todo_A", "TEST_iter68_todo_B", "TEST_iter68_todo_C"}

        # Toggle todo A done -> True
        r = requests.patch(f"{BASE_URL}/api/todos/{ids[0]}", json={"done": True}, headers=hdr)
        assert r.status_code == 200
        assert r.json()["done"] is True

        # After toggle, done items sink to bottom
        r = requests.get(f"{BASE_URL}/api/todos?scope=team", headers=hdr)
        arr = [t for t in r.json() if t["id"] in ids]
        # first entries should be undone
        done_positions = [i for i, t in enumerate(arr) if t["done"]]
        undone_positions = [i for i, t in enumerate(arr) if not t["done"]]
        assert min(done_positions) > max(undone_positions), f"Done should be at bottom: {arr}"

        # Update text
        r = requests.patch(f"{BASE_URL}/api/todos/{ids[1]}", json={"text": "  TEST_iter68_todo_B_upd  "}, headers=hdr)
        assert r.status_code == 200
        assert r.json()["text"] == "TEST_iter68_todo_B_upd"

        # Delete todo C
        r = requests.delete(f"{BASE_URL}/api/todos/{ids[2]}", headers=hdr)
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        created["todos"].remove(ids[2])

        # 404 on further delete
        r = requests.delete(f"{BASE_URL}/api/todos/{ids[2]}", headers=hdr)
        assert r.status_code == 404

    def test_competition_scope(self, state):
        hdr, created = state["hdr"], state["created"]
        comp_id = created["competitions"][0]
        r = requests.post(f"{BASE_URL}/api/todos",
                          json={"text": "TEST_iter68_todo_comp", "scope": "competition", "ref_id": comp_id},
                          headers=hdr)
        assert r.status_code == 200
        tid = r.json()["id"]
        created["todos"].append(tid)
        # Filter list by ref_id
        r = requests.get(f"{BASE_URL}/api/todos?scope=competition&ref_id={comp_id}", headers=hdr)
        assert r.status_code == 200
        assert any(t["id"] == tid for t in r.json())
        # Team-scope list should NOT include comp todo
        r = requests.get(f"{BASE_URL}/api/todos?scope=team", headers=hdr)
        assert not any(t["id"] == tid for t in r.json())

    def test_event_scope(self, state):
        hdr, created = state["hdr"], state["created"]
        ev_id = created["events"][0]
        r = requests.post(f"{BASE_URL}/api/todos",
                          json={"text": "TEST_iter68_todo_event", "scope": "event", "ref_id": ev_id},
                          headers=hdr)
        assert r.status_code == 200
        tid = r.json()["id"]
        created["todos"].append(tid)
        r = requests.get(f"{BASE_URL}/api/todos?scope=event&ref_id={ev_id}", headers=hdr)
        assert r.status_code == 200
        assert any(t["id"] == tid for t in r.json())

    def test_blank_text_rejected(self, state):
        r = requests.post(f"{BASE_URL}/api/todos", json={"text": "   ", "scope": "team"}, headers=state["hdr"])
        assert r.status_code == 400


# ============================================================
# P1.1 — Reorder sign-up sheets
# ============================================================
class TestSignupReorder:
    def test_reorder_persists_and_new_floats_top(self, state):
        hdr, created = state["hdr"], state["created"]

        # Create sheet A then sheet B — B should float above A (lower order)
        r = requests.post(f"{BASE_URL}/api/team/signups",
                          json={"name": "TEST_iter68_sheetA"}, headers=hdr)
        assert r.status_code == 200
        a_id = r.json()["id"]
        created["signups"].append(a_id)
        a_order = r.json()["order"]

        r = requests.post(f"{BASE_URL}/api/team/signups",
                          json={"name": "TEST_iter68_sheetB"}, headers=hdr)
        assert r.status_code == 200
        b_id = r.json()["id"]
        b_order = r.json()["order"]
        created["signups"].append(b_id)

        assert b_order < a_order, "Newly created sheet must float to top"

        # Confirm list order (sorted by order asc)
        r = requests.get(f"{BASE_URL}/api/team/signups", headers=hdr)
        ids = [s["id"] for s in r.json() if s["id"] in (a_id, b_id)]
        assert ids == [b_id, a_id], f"Expected B before A, got {ids}"

        # Reorder: put A on top
        r = requests.post(f"{BASE_URL}/api/team/signups/reorder",
                          json={"ids": [a_id, b_id]}, headers=hdr)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Reload and confirm
        r = requests.get(f"{BASE_URL}/api/team/signups", headers=hdr)
        ids = [s["id"] for s in r.json() if s["id"] in (a_id, b_id)]
        assert ids == [a_id, b_id], f"Reorder did not persist: {ids}"


# ============================================================
# P1.2 — Attendance tool
# ============================================================
class TestAttendance:
    def test_full_session_lifecycle(self, state):
        hdr, created = state["hdr"], state["created"]

        # Create session
        r = requests.post(f"{BASE_URL}/api/team/attendance",
                          json={"title": "TEST_iter68_att", "date": "2026-06-10"}, headers=hdr)
        assert r.status_code == 200, r.text
        sess = r.json()
        sid = sess["id"]
        created["attendance"].append(sid)
        assert sess["title"] == "TEST_iter68_att"
        assert sess["date"] == "2026-06-10"

        # Blank title rejected
        r = requests.post(f"{BASE_URL}/api/team/attendance",
                          json={"title": "   "}, headers=hdr)
        assert r.status_code == 400

        # GET single — has summary; roster_total should equal non-parent count
        # (the applereview account already has seed roster + parents, so we
        # dynamically compute the expected non-parent total)
        rr = requests.get(f"{BASE_URL}/api/roster", headers=hdr)
        assert rr.status_code == 200
        expected_total = sum(1 for m in rr.json() if (m.get("role") or "").lower() != "parent")

        r = requests.get(f"{BASE_URL}/api/team/attendance/{sid}", headers=hdr)
        assert r.status_code == 200
        body = r.json()
        assert "summary" in body
        assert body["summary"]["member_total"] == expected_total, \
            f"parent must be excluded, got {body['summary']}, expected {expected_total}"
        assert body["summary"]["unmarked"] == expected_total

        # Mark ATH1 present
        ath1 = created["roster"][0]
        ath2 = created["roster"][1]
        r = requests.put(f"{BASE_URL}/api/team/attendance/{sid}/mark",
                         json={"member_id": ath1, "status": "present"}, headers=hdr)
        assert r.status_code == 200
        s = r.json()["summary"]
        assert s["present"] == 1 and s["absent"] == 0 and s["excused"] == 0
        assert s["unmarked"] == expected_total - 1

        # Mark ATH2 excused
        r = requests.put(f"{BASE_URL}/api/team/attendance/{sid}/mark",
                         json={"member_id": ath2, "status": "excused"}, headers=hdr)
        assert r.status_code == 200
        s = r.json()["summary"]
        assert s["present"] == 1 and s["excused"] == 1 and s["unmarked"] == expected_total - 2

        # Change ATH2 to absent
        r = requests.put(f"{BASE_URL}/api/team/attendance/{sid}/mark",
                         json={"member_id": ath2, "status": "absent"}, headers=hdr)
        s = r.json()["summary"]
        assert s["absent"] == 1 and s["excused"] == 0

        # Clear ATH1 (status=null)
        r = requests.put(f"{BASE_URL}/api/team/attendance/{sid}/mark",
                         json={"member_id": ath1, "status": None}, headers=hdr)
        assert r.status_code == 200
        s = r.json()["summary"]
        assert s["present"] == 0

        # Invalid member -> 404
        r = requests.put(f"{BASE_URL}/api/team/attendance/{sid}/mark",
                         json={"member_id": "not-a-real-id", "status": "present"}, headers=hdr)
        assert r.status_code == 404

        # Update title/date
        r = requests.patch(f"{BASE_URL}/api/team/attendance/{sid}",
                           json={"title": "TEST_iter68_att_upd"}, headers=hdr)
        assert r.status_code == 200
        assert r.json()["title"] == "TEST_iter68_att_upd"

        # List includes session with summary
        r = requests.get(f"{BASE_URL}/api/team/attendance", headers=hdr)
        assert r.status_code == 200
        found = next((s for s in r.json() if s["id"] == sid), None)
        assert found is not None
        assert "summary" in found

        # Delete
        r = requests.delete(f"{BASE_URL}/api/team/attendance/{sid}", headers=hdr)
        assert r.status_code == 200
        created["attendance"].remove(sid)
        # 404 after delete
        r = requests.get(f"{BASE_URL}/api/team/attendance/{sid}", headers=hdr)
        assert r.status_code == 404


# ============================================================
# P1.3 — Event <-> Sign-up sheet linkage
# ============================================================
class TestEventSignupLink:
    def test_event_id_filter_and_persistence(self, state):
        hdr, created = state["hdr"], state["created"]
        ev_id = created["events"][0]

        # Create a sheet linked to the event
        r = requests.post(f"{BASE_URL}/api/team/signups",
                          json={"name": "TEST_iter68_ev_sheet", "event_id": ev_id}, headers=hdr)
        assert r.status_code == 200
        sid = r.json()["id"]
        assert r.json().get("event_id") == ev_id
        created["signups"].append(sid)

        # Filter by event_id
        r = requests.get(f"{BASE_URL}/api/team/signups?event_id={ev_id}", headers=hdr)
        assert r.status_code == 200
        arr = r.json()
        assert any(s["id"] == sid for s in arr)
        assert all(s.get("event_id") == ev_id for s in arr), \
            f"Filter did not restrict to event: {[s.get('event_id') for s in arr]}"

        # Different event_id → empty
        r = requests.get(f"{BASE_URL}/api/team/signups?event_id=nonexistent-evt", headers=hdr)
        assert r.status_code == 200
        assert not any(s["id"] == sid for s in r.json())


# ============================================================
# P2.4 — Expanded roster fields + custom columns
# ============================================================
class TestRosterExpanded:
    def test_expanded_fields_persist_on_create_and_edit(self, state):
        hdr, created = state["hdr"], state["created"]

        payload = {
            "name": "TEST_iter68_expanded",
            "role": "athlete",
            "preferred_name": "Bee",
            "food_allergies": "peanuts",
            "other_allergies": "latex",
            "medical_concerns": "asthma",
            "host_bonding_opt_in": True,
        }
        r = requests.post(f"{BASE_URL}/api/roster", json=payload, headers=hdr)
        assert r.status_code == 200, r.text
        mid = r.json()["id"]
        created["roster"].append(mid)

        # Verify GET returns the fields
        r = requests.get(f"{BASE_URL}/api/roster", headers=hdr)
        member = next(m for m in r.json() if m["id"] == mid)
        assert member["preferred_name"] == "Bee"
        assert member["food_allergies"] == "peanuts"
        assert member["other_allergies"] == "latex"
        assert member["medical_concerns"] == "asthma"
        assert member["host_bonding_opt_in"] is True

        # Update host_bonding_opt_in -> False and food_allergies via PATCH
        r = requests.patch(f"{BASE_URL}/api/roster/{mid}",
                           json={"host_bonding_opt_in": False, "food_allergies": "dairy"},
                           headers=hdr)
        assert r.status_code == 200
        assert r.json()["host_bonding_opt_in"] is False
        assert r.json()["food_allergies"] == "dairy"

    def test_custom_columns_crud_and_values(self, state):
        hdr, created = state["hdr"], state["created"]

        # Create column
        r = requests.post(f"{BASE_URL}/api/roster/columns",
                          json={"label": "TEST_iter68_col_shoesize"}, headers=hdr)
        assert r.status_code == 200, r.text
        col_id = r.json()["id"]
        assert r.json()["label"] == "TEST_iter68_col_shoesize"
        created["columns"].append(col_id)

        # Blank label rejected
        r = requests.post(f"{BASE_URL}/api/roster/columns", json={"label": "   "}, headers=hdr)
        assert r.status_code == 400

        # Rename column
        r = requests.patch(f"{BASE_URL}/api/roster/columns/{col_id}",
                           json={"label": "TEST_iter68_col_size"}, headers=hdr)
        assert r.status_code == 200
        assert r.json()["label"] == "TEST_iter68_col_size"

        # List columns
        r = requests.get(f"{BASE_URL}/api/roster/columns", headers=hdr)
        assert r.status_code == 200
        assert any(c["id"] == col_id for c in r.json())

        # Create a member with the custom column value
        r = requests.post(f"{BASE_URL}/api/roster",
                          json={"name": "TEST_iter68_custom_m", "role": "athlete",
                                "custom": {col_id: "8"}}, headers=hdr)
        assert r.status_code == 200
        mid = r.json()["id"]
        created["roster"].append(mid)
        assert r.json().get("custom", {}).get(col_id) == "8"

        # Update value via PATCH
        r = requests.patch(f"{BASE_URL}/api/roster/{mid}",
                           json={"custom": {col_id: "9"}}, headers=hdr)
        assert r.status_code == 200
        assert r.json()["custom"][col_id] == "9"

        # Verify via GET
        r = requests.get(f"{BASE_URL}/api/roster", headers=hdr)
        member = next(m for m in r.json() if m["id"] == mid)
        assert member["custom"][col_id] == "9"

        # Delete column → member.custom.<col_id> should be unset
        r = requests.delete(f"{BASE_URL}/api/roster/columns/{col_id}", headers=hdr)
        assert r.status_code == 200
        created["columns"].remove(col_id)
        r = requests.get(f"{BASE_URL}/api/roster", headers=hdr)
        member = next(m for m in r.json() if m["id"] == mid)
        assert col_id not in (member.get("custom") or {}), \
            f"Column value not scrubbed on delete: {member.get('custom')}"

        # 404 on further delete
        r = requests.delete(f"{BASE_URL}/api/roster/columns/{col_id}", headers=hdr)
        assert r.status_code == 404


# ============================================================
# P2.5 — Block a granted user from a sheet (solo owner)
# ============================================================
class TestBlocks:
    def test_solo_owner_get_blocks_returns_empty_members(self, state):
        hdr, created = state["hdr"], state["created"]

        # Create a sheet to have a valid resource_id
        r = requests.post(f"{BASE_URL}/api/team/signups",
                          json={"name": "TEST_iter68_block_sheet"}, headers=hdr)
        assert r.status_code == 200
        sheet_id = r.json()["id"]
        created["signups"].append(sheet_id)

        r = requests.get(f"{BASE_URL}/api/team/blocks/signup/{sheet_id}", headers=hdr)
        assert r.status_code == 200
        body = r.json()
        assert body["is_owner"] is True, "Solo test account must be owner"
        assert body["members"] == [], f"Solo household should have no other members: {body['members']}"
        assert body["blocked_user_ids"] == []

    def test_block_toggle_rejects_non_household_member(self, state):
        hdr, created = state["hdr"], state["created"]
        # Use one of the signup sheets already created
        # Create a sheet if we don't already have one
        r = requests.post(f"{BASE_URL}/api/team/signups",
                          json={"name": "TEST_iter68_block_sheet2"}, headers=hdr)
        assert r.status_code == 200
        sid = r.json()["id"]
        created["signups"].append(sid)

        # Trying to block a non-existent user should 404 (not in household)
        r = requests.put(f"{BASE_URL}/api/team/blocks",
                         json={"blocked_user_id": "not-in-household",
                               "resource": "signup", "resource_id": sid},
                         headers=hdr)
        assert r.status_code == 404, r.text
