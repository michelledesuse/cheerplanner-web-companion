"""Iter63 - Spreadsheet import (Team Hub kinds) tests.

Focus:
 - Template download (csv/xlsx) for team_* kinds and non-team kind still works
 - Preview: shapes for roster / team_sizes / team_paperwork / team_payments
 - Commit: roster update-by-name; team_sizes/paperwork/payments create resources
 - 403 gating: non-team-access user is blocked on team kinds but not on 'expenses'
 - Cleanup: all created rows are deleted at the end so applereview stays clean
"""
import io
import os
import uuid
import csv
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

REVIEW_EMAIL = "applereview@cheerplanner.app"
REVIEW_PASSWORD = "Review2026!"


# ------------------------------ Fixtures --------------------------------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": REVIEW_EMAIL, "password": REVIEW_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["user"].get("team_access") is True, "applereview must have team_access=true"
    return body["access_token"]


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="module")
def no_access_user():
    """Create a fresh user with NO team_access; delete afterwards."""
    email = f"TEST_noaccess_{uuid.uuid4().hex[:8]}@example.com"
    password = "Passw0rd!TEST"
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": password, "name": "TEST NoAccess"}, timeout=30)
    assert r.status_code == 200, f"signup failed: {r.text}"
    body = r.json()
    token = body["access_token"]
    user_id = body["user"]["id"]
    # confirm team_access is falsy
    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30).json()
    assert not me.get("team_access"), "new user should not have team_access"
    yield {"token": token, "id": user_id, "headers": {"Authorization": f"Bearer {token}"}}
    # cleanup: delete account
    try:
        requests.request(
            "DELETE", f"{API}/auth/me",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"password": password},
            timeout=30,
        )
    except Exception:
        pass


# Track created resources for cleanup
_created = {"team_ids": [], "roster_ids": [], "size_col_ids": [], "size_col_values_added": [],
            "paperwork_sheet_ids": [], "payment_tracker_ids": []}


# ------------------------------ Template tests --------------------------------
@pytest.mark.parametrize("kind", ["roster", "team_sizes", "team_paperwork", "team_payments"])
def test_template_csv(owner_headers, kind):
    r = requests.get(f"{API}/import/template/{kind}?fmt=csv", headers=owner_headers, timeout=30)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers.get("content-type", "")
    assert r.text.strip().splitlines()[0]  # header row


@pytest.mark.parametrize("kind", ["roster", "team_sizes", "team_paperwork", "team_payments"])
def test_template_xlsx(owner_headers, kind):
    r = requests.get(f"{API}/import/template/{kind}?fmt=xlsx", headers=owner_headers, timeout=30)
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers.get("content-type", "")
    assert r.content[:2] == b"PK"  # xlsx = zip


def test_template_non_team_still_works(owner_headers):
    r = requests.get(f"{API}/import/template/expenses?fmt=csv", headers=owner_headers, timeout=30)
    assert r.status_code == 200
    assert "Date" in r.text.splitlines()[0]


# ------------------------------ Auth gating (403) -----------------------------
def _csv_bytes(header_row, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header_row)
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


@pytest.mark.parametrize("kind", ["roster", "team_sizes", "team_paperwork", "team_payments"])
def test_preview_403_without_team_access(no_access_user, kind):
    files = {"file": ("t.csv", _csv_bytes(["Name"], [["Anyone"]]), "text/csv")}
    data = {"kind": kind}
    r = requests.post(f"{API}/import/preview", headers=no_access_user["headers"], files=files, data=data, timeout=30)
    assert r.status_code == 403, f"expected 403 for {kind}, got {r.status_code}: {r.text}"


@pytest.mark.parametrize("kind", ["roster", "team_sizes", "team_paperwork", "team_payments"])
def test_commit_403_without_team_access(no_access_user, kind):
    payload = {"kind": kind, "rows": [{"name": "X"}]}
    r = requests.post(f"{API}/import/commit", headers=no_access_user["headers"], json=payload, timeout=30)
    assert r.status_code == 403, f"expected 403 for {kind} commit, got {r.status_code}: {r.text}"


def test_expenses_still_works_without_team_access(no_access_user):
    """Non-team kind must not be gated."""
    csv_bytes = _csv_bytes(
        ["Date", "Athlete", "Category", "Amount"],
        [["2026-01-05", "TEST NoAccess Ava", "Tuition", "10.00"]],
    )
    files = {"file": ("e.csv", csv_bytes, "text/csv")}
    r = requests.post(f"{API}/import/preview", headers=no_access_user["headers"],
                      files=files, data={"kind": "expenses"}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "expenses"


# ------------------------------ Preview shapes --------------------------------
def test_preview_roster(owner_headers):
    csv_bytes = _csv_bytes(
        ["First Name", "Last Name", "Role", "Team(s)", "Parent First Name", "Parent Phone"],
        [["TESTAva", "Zzimport", "Athlete", "TEST_Team_ImportA", "Sarah", "(555) 111-2222"]],
    )
    files = {"file": ("r.csv", csv_bytes, "text/csv")}
    r = requests.post(f"{API}/import/preview", headers=owner_headers,
                      files=files, data={"kind": "roster"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "roster"
    assert isinstance(body["rows"], list) and len(body["rows"]) == 1
    row = body["rows"][0]
    assert row["name"] == "TESTAva Zzimport"
    assert row["role"] == "athlete"
    assert "TEST_Team_ImportA" in row["team_names"]
    assert "existing_teams" in body


def test_preview_team_sizes(owner_headers):
    csv_bytes = _csv_bytes(
        ["Name", "TEST_Shirt63", "TEST_Bow63"],
        [["TESTImport Person63", "AM", "Red"]],
    )
    files = {"file": ("s.csv", csv_bytes, "text/csv")}
    r = requests.post(f"{API}/import/preview", headers=owner_headers,
                      files=files, data={"kind": "team_sizes"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "team_sizes"
    assert body["columns"] == ["TEST_Shirt63", "TEST_Bow63"]
    assert body["rows"][0]["name"] == "TESTImport Person63"
    assert body["rows"][0]["cells"]["TEST_Shirt63"] == "AM"
    assert "existing_members" in body


def test_preview_team_paperwork(owner_headers):
    csv_bytes = _csv_bytes(
        ["Name", "TEST_Waiver63", "TEST_Physical63"],
        [["TESTImport Person63", "Yes", "No"]],
    )
    files = {"file": ("p.csv", csv_bytes, "text/csv")}
    r = requests.post(f"{API}/import/preview", headers=owner_headers,
                      files=files, data={"kind": "team_paperwork"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["TEST_Waiver63", "TEST_Physical63"]
    assert body["rows"][0]["cells"]["TEST_Waiver63"] == "Yes"


def test_preview_team_payments(owner_headers):
    csv_bytes = _csv_bytes(
        ["Name", "Amount Paid", "Method", "Date Paid", "Paid"],
        [["TESTImport Person63", "50.00", "Cash", "2026-01-05", "Yes"]],
    )
    files = {"file": ("pay.csv", csv_bytes, "text/csv")}
    r = requests.post(f"{API}/import/preview", headers=owner_headers,
                      files=files, data={"kind": "team_payments"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    row = body["rows"][0]
    assert row["name"] == "TESTImport Person63"
    assert row["amount_paid"] == 50.0
    assert row["method"] == "Cash"
    assert row["paid_on"] == "2026-01-05"
    assert row["paid"] is True


# ------------------------------ Commit + persistence --------------------------
def test_roster_commit_create_and_update_by_name(owner_headers):
    """First commit creates member+team; second commit with same name updates fields."""
    name = f"TESTImport Person63"
    team_name = f"TEST_Team_ImportA"
    # First commit: create
    payload1 = {
        "kind": "roster",
        "rows": [{
            "name": name, "first_name": "TESTImport", "last_name": "Person63",
            "role": "athlete", "team_names": [team_name], "phone": "(555) 000-1111",
        }],
    }
    r = requests.post(f"{API}/import/commit", headers=owner_headers, json=payload1, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 1
    # verify persistence
    roster = requests.get(f"{API}/roster", headers=owner_headers, timeout=30).json()
    match = [m for m in roster if m.get("name") == name]
    assert len(match) == 1
    assert match[0].get("phone") == "(555) 000-1111"
    member_id = match[0]["id"]
    _created["roster_ids"].append(member_id)

    # Second commit: update (same name, new phone + notes) — should update, not duplicate
    payload2 = {
        "kind": "roster",
        "rows": [{
            "name": name, "role": "athlete", "phone": "(555) 999-8888", "notes": "TEST updated note",
        }],
    }
    r2 = requests.post(f"{API}/import/commit", headers=owner_headers, json=payload2, timeout=30)
    assert r2.status_code == 200
    roster2 = requests.get(f"{API}/roster", headers=owner_headers, timeout=30).json()
    match2 = [m for m in roster2 if m.get("name") == name]
    assert len(match2) == 1, "roster update by name should not duplicate"
    assert match2[0]["id"] == member_id, "same member id retained"
    assert match2[0].get("phone") == "(555) 999-8888"
    assert match2[0].get("notes") == "TEST updated note"

    # verify team was auto-created
    teams = requests.get(f"{API}/teams", headers=owner_headers, timeout=30).json()
    tm = [t for t in teams if t.get("name") == team_name]
    assert len(tm) == 1
    _created["team_ids"].append(tm[0]["id"])


def test_team_sizes_commit_adds_columns_and_values(owner_headers):
    name = "TESTImport Person63"
    label_shirt = "TEST_Shirt63"
    label_bow = "TEST_Bow63"
    payload = {
        "kind": "team_sizes",
        "columns": [label_shirt, label_bow],
        "rows": [{"name": name, "cells": {label_shirt: "AM", label_bow: "Red"}}],
    }
    r = requests.post(f"{API}/import/commit", headers=owner_headers, json=payload, timeout=30)
    assert r.status_code == 200, r.text
    # verify via GET sizes
    sheet = requests.get(f"{API}/team/sizes", headers=owner_headers, timeout=30).json()
    cols_by_label = {c["label"]: c["id"] for c in sheet.get("columns", [])}
    assert label_shirt in cols_by_label
    assert label_bow in cols_by_label
    _created["size_col_ids"].extend([cols_by_label[label_shirt], cols_by_label[label_bow]])
    # verify value was set for the member
    roster = requests.get(f"{API}/roster", headers=owner_headers, timeout=30).json()
    mid = next((m["id"] for m in roster if m.get("name") == name), None)
    assert mid is not None
    vals = sheet.get("values") or {}
    assert vals.get(mid, {}).get(cols_by_label[label_shirt]) == "AM"
    _created["size_col_values_added"].append(mid)


def test_team_paperwork_commit_creates_sheet(owner_headers):
    sheet_name = f"TEST_Paperwork_{uuid.uuid4().hex[:6]}"
    payload = {
        "kind": "team_paperwork",
        "sheet_name": sheet_name,
        "columns": ["TEST_Waiver63", "TEST_Physical63"],
        "rows": [{"name": "TESTImport Person63", "cells": {"TEST_Waiver63": "Yes", "TEST_Physical63": "No"}}],
    }
    r = requests.post(f"{API}/import/commit", headers=owner_headers, json=payload, timeout=30)
    assert r.status_code == 200, r.text
    sheets = requests.get(f"{API}/team/paperwork", headers=owner_headers, timeout=30).json()
    match = [s for s in sheets if s.get("name") == sheet_name]
    assert len(match) == 1
    _created["paperwork_sheet_ids"].append(match[0]["id"])
    # ensure items exist
    labels = [it["label"] for it in match[0].get("items", [])]
    assert "TEST_Waiver63" in labels and "TEST_Physical63" in labels


def test_team_payments_commit_creates_tracker(owner_headers):
    tracker_name = f"TEST_Payments_{uuid.uuid4().hex[:6]}"
    payload = {
        "kind": "team_payments",
        "sheet_name": tracker_name,
        "tracker_amount": 100,
        "rows": [{
            "name": "TESTImport Person63", "amount_paid": 50.0, "method": "Cash",
            "paid_on": "2026-01-05", "paid": True,
        }],
    }
    r = requests.post(f"{API}/import/commit", headers=owner_headers, json=payload, timeout=30)
    assert r.status_code == 200, r.text
    trackers = requests.get(f"{API}/team/payments", headers=owner_headers, timeout=30).json()
    match = [t for t in trackers if t.get("name") == tracker_name]
    assert len(match) == 1
    tr = match[0]
    assert tr.get("amount") == 100
    assert len(tr.get("entries", [])) == 1
    entry = tr["entries"][0]
    assert entry["amount_paid"] == 50.0
    assert entry["method"] == "Cash"
    assert entry["paid"] is True
    _created["payment_tracker_ids"].append(tr["id"])


# ------------------------------ Cleanup ---------------------------------------
def test_zz_cleanup(owner_headers):
    """Runs last; removes everything the earlier tests created."""
    # Delete payment trackers
    for tid in _created["payment_tracker_ids"]:
        requests.delete(f"{API}/team/payments/{tid}", headers=owner_headers, timeout=30)
    # Delete paperwork sheets
    for sid in _created["paperwork_sheet_ids"]:
        requests.delete(f"{API}/team/paperwork/{sid}", headers=owner_headers, timeout=30)
    # Remove size columns we added
    for cid in _created["size_col_ids"]:
        requests.delete(f"{API}/team/sizes/columns/{cid}", headers=owner_headers, timeout=30)
    # Delete roster members
    for mid in _created["roster_ids"]:
        requests.delete(f"{API}/roster/{mid}", headers=owner_headers, timeout=30)
    # Delete teams
    for tid in _created["team_ids"]:
        requests.delete(f"{API}/teams/{tid}", headers=owner_headers, timeout=30)

    # Verify owner still has team_access
    me = requests.get(f"{API}/auth/me", headers=owner_headers, timeout=30).json()
    assert me.get("team_access") is True, "applereview must keep team_access=true"

    # Verify created roster members are gone
    roster = requests.get(f"{API}/roster", headers=owner_headers, timeout=30).json()
    for mid in _created["roster_ids"]:
        assert not any(m["id"] == mid for m in roster), f"roster {mid} was not deleted"
