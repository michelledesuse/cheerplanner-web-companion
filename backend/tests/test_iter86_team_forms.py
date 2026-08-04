"""Tests for the new Team Forms feature (iteration 86).

Covers: form CRUD, questions (all 6 types), coach response upsert, tally
(2 Chicken / 1 Pasta), share link create + public data + public submit,
lock enforcement (public + coach), remind endpoint (Twilio LIVE — assert
200 only, do not spam), and roadmap 'Custom Team Forms' / 'In Development'
label rename.
"""
import os
import time
import pytest
import requests

def _base():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not url:
        # fall back to frontend/.env
        try:
            with open("/app/frontend/.env") as fh:
                for line in fh:
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    assert url, "EXPO_PUBLIC_BACKEND_URL is required"
    return url.rstrip("/")

BASE_URL = _base()

EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def roster(api):
    r = api.get(f"{BASE_URL}/api/roster", timeout=20)
    assert r.status_code == 200
    members = [m for m in r.json() if (m.get("role") or "athlete") != "parent"]
    assert len(members) >= 3, f"need at least 3 non-parent roster members, got {len(members)}"
    return members[:3]


@pytest.fixture(scope="module")
def created_form(api):
    r = api.post(f"{BASE_URL}/api/team/forms", json={
        "name": "TEST_Iter86 Meal Order",
        "description": "Automated backend test",
        "questions": [],
    }, timeout=20)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc.get("id") and doc.get("name") == "TEST_Iter86 Meal Order"
    assert doc.get("locked") is False
    yield doc
    # cleanup
    api.delete(f"{BASE_URL}/api/team/forms/{doc['id']}", timeout=15)


# ---------- Forms CRUD + questions ----------
class TestFormsCRUD:
    def test_form_appears_in_list(self, api, created_form):
        r = api.get(f"{BASE_URL}/api/team/forms", timeout=15)
        assert r.status_code == 200
        assert any(f["id"] == created_form["id"] for f in r.json())

    def test_add_questions_all_types(self, api, created_form):
        qs = [
            {"label": "Meal choice", "type": "choice", "options": ["Chicken", "Pasta", "Veggie"], "required": False, "order": 0},
            {"label": "Sides", "type": "multi", "options": ["Salad", "Fries", "Rice"], "required": False, "order": 1},
            {"label": "Coming?", "type": "yesno", "options": [], "required": False, "order": 2},
            {"label": "Guests", "type": "number", "options": [], "required": False, "order": 3},
            {"label": "Nickname", "type": "text", "options": [], "required": False, "order": 4},
            {"label": "Notes", "type": "paragraph", "options": [], "required": False, "order": 5},
        ]
        r = api.patch(f"{BASE_URL}/api/team/forms/{created_form['id']}", json={"questions": qs}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["questions"]) == 6
        types = [q["type"] for q in d["questions"]]
        assert types == ["choice", "multi", "yesno", "number", "text", "paragraph"]

    def test_get_form_returns_detail(self, api, created_form):
        r = api.get(f"{BASE_URL}/api/team/forms/{created_form['id']}", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "questions" in d and "members" in d and "tally" in d and "summary" in d
        assert d["summary"]["member_total"] >= 3


# ---------- Coach response upsert + tally ----------
class TestResponsesAndTally:
    def test_coach_upsert_and_tally(self, api, created_form, roster):
        # get question ids
        r = api.get(f"{BASE_URL}/api/team/forms/{created_form['id']}", timeout=15)
        d = r.json()
        qs = {q["label"]: q["id"] for q in d["questions"]}
        meal_qid = qs["Meal choice"]
        num_qid = qs["Guests"]

        # Ava → Chicken, 2 ; Bella → Pasta, 1 ; Cara → Chicken, 3
        answers_by_member = [
            (roster[0]["id"], {meal_qid: "Chicken", num_qid: 2}),
            (roster[1]["id"], {meal_qid: "Pasta", num_qid: 1}),
            (roster[2]["id"], {meal_qid: "Chicken", num_qid: 3}),
        ]
        for mid, ans in answers_by_member:
            r = api.put(f"{BASE_URL}/api/team/forms/{created_form['id']}/response",
                        json={"member_id": mid, "answers": ans}, timeout=20)
            assert r.status_code == 200, r.text

        # verify tally
        r = api.get(f"{BASE_URL}/api/team/forms/{created_form['id']}", timeout=15)
        d = r.json()
        meal_tally = next(t for t in d["tally"] if t["question_id"] == meal_qid)
        counts = {c["value"]: c["count"] for c in meal_tally["counts"]}
        assert counts.get("Chicken") == 2, f"expected 2 Chicken, got {counts}"
        assert counts.get("Pasta") == 1, f"expected 1 Pasta, got {counts}"

        # number tally
        num_tally = next(t for t in d["tally"] if t["question_id"] == num_qid)
        assert num_tally["sum"] == 6
        assert num_tally["answered"] == 3

        # per-member marked answered
        answered = [m for m in d["members"] if m["answered"]]
        assert len(answered) >= 3


# ---------- Share link + public data + public submit ----------
class TestShare:
    def test_share_create_and_public_data(self, api, created_form):
        r = api.post(f"{BASE_URL}/api/team/share", json={"kind": "form", "ref_id": created_form["id"]}, timeout=15)
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        assert token
        pytest.share_token = token

        # public GET data
        r2 = requests.get(f"{BASE_URL}/api/public/share/{token}/data", timeout=15)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["kind"] == "form"
        assert d["title"] == "TEST_Iter86 Meal Order"
        assert len(d["questions"]) == 6
        assert d["locked"] is False
        assert len(d["members"]) >= 3

    def test_public_page_renders(self, api):
        token = pytest.share_token
        r = requests.get(f"{BASE_URL}/api/public/s/{token}", timeout=15)
        assert r.status_code == 200
        assert "CheerPlanner" in r.text
        assert "renderForm" in r.text  # form JS present

    def test_public_submit_updates_response(self, api, created_form, roster):
        token = pytest.share_token
        # get question ids
        r = api.get(f"{BASE_URL}/api/team/forms/{created_form['id']}", timeout=15)
        d = r.json()
        meal_qid = next(q["id"] for q in d["questions"] if q["label"] == "Meal choice")

        # Parent switches Bella from Pasta to Veggie via public link
        r2 = requests.post(f"{BASE_URL}/api/public/share/{token}/submit",
                           json={"member_id": roster[1]["id"], "answers": {meal_qid: "Veggie"}}, timeout=15)
        assert r2.status_code == 200, r2.text

        # verify tally now shows 2 Chicken, 1 Veggie (no more Pasta)
        r3 = api.get(f"{BASE_URL}/api/team/forms/{created_form['id']}", timeout=15)
        d3 = r3.json()
        meal_tally = next(t for t in d3["tally"] if t["question_id"] == meal_qid)
        counts = {c["value"]: c["count"] for c in meal_tally["counts"]}
        assert counts.get("Chicken") == 2
        assert counts.get("Veggie") == 1
        assert counts.get("Pasta", 0) == 0


# ---------- Lock enforcement ----------
class TestLock:
    def test_lock_blocks_public_submit(self, api, created_form, roster):
        # Lock the form
        r = api.patch(f"{BASE_URL}/api/team/forms/{created_form['id']}", json={"locked": True}, timeout=15)
        assert r.status_code == 200
        assert r.json()["locked"] is True

        # public data shows locked=True
        token = pytest.share_token
        r2 = requests.get(f"{BASE_URL}/api/public/share/{token}/data", timeout=15)
        assert r2.status_code == 200 and r2.json()["locked"] is True

        # public submit rejected 400
        d = api.get(f"{BASE_URL}/api/team/forms/{created_form['id']}", timeout=15).json()
        meal_qid = next(q["id"] for q in d["questions"] if q["label"] == "Meal choice")
        r3 = requests.post(f"{BASE_URL}/api/public/share/{token}/submit",
                           json={"member_id": roster[0]["id"], "answers": {meal_qid: "Pasta"}}, timeout=15)
        assert r3.status_code == 400, r3.text

        # coach upsert also rejected
        r4 = api.put(f"{BASE_URL}/api/team/forms/{created_form['id']}/response",
                     json={"member_id": roster[0]["id"], "answers": {meal_qid: "Pasta"}}, timeout=15)
        assert r4.status_code == 400, r4.text

        # unlock for cleanup
        api.patch(f"{BASE_URL}/api/team/forms/{created_form['id']}", json={"locked": False}, timeout=15)


# ---------- Remind (Twilio LIVE — assert 200 only, call ONCE) ----------
class TestRemind:
    def test_remind_endpoint_responds(self, api, created_form):
        r = api.post(f"{BASE_URL}/api/team/forms/{created_form['id']}/remind",
                     json={"base_url": BASE_URL}, timeout=25)
        # Twilio LIVE — just assert 200 shape
        assert r.status_code == 200, r.text
        j = r.json()
        assert "sent" in j and isinstance(j["sent"], int)
        assert "no_phone" in j and isinstance(j["no_phone"], list)


# ---------- Roadmap: Custom Team Forms + In Development label ----------
class TestRoadmap:
    def test_custom_team_forms_planned_in_development(self, api):
        r = api.get(f"{BASE_URL}/api/roadmap", timeout=15)
        assert r.status_code == 200, r.text
        planned = r.json().get("planned") or []
        titles = [(p.get("title") or "").lower() for p in planned]
        match = next((p for p in planned if "custom team forms" in (p.get("title") or "").lower()), None)
        assert match, f"'Custom Team Forms' missing in planned roadmap items. titles={titles}"
        assert (match.get("status") or "").lower() == "in_progress", f"expected in_progress, got {match.get('status')}"
