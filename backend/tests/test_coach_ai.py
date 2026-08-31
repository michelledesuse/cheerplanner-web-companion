"""Tests for the AI Coaching Assistant (Team Hub) endpoints — /api/team/coach-ai/*.

Covers: access control, chat cheer question, chat off-topic decline,
chat history retrieval, and flyer generation (expected 402 due to
exhausted Emergent Universal Key budget).
"""
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # Fallback to frontend/.env
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip()
                    break
    except FileNotFoundError:
        pass
BASE_URL = (BASE_URL or "").rstrip("/")

COACH = {"email": "coach.casey@cheerplanner.app", "password": "CheerDemo2026!"}
PARENT = {"email": "parent.taylor@cheerplanner.app", "password": "CheerDemo2026!"}
ATHLETE = {"email": "sophia.athlete@cheerplanner.app", "password": "CheerDemo2026!"}

DECLINE_SNIPPET = "I can only help with cheerleading and coaching topics"


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in login response: {data}"
    return token


@pytest.fixture(scope="module")
def coach_headers():
    return {"Authorization": f"Bearer {_login(COACH)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def parent_headers():
    return {"Authorization": f"Bearer {_login(PARENT)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def athlete_headers():
    return {"Authorization": f"Bearer {_login(ATHLETE)}", "Content-Type": "application/json"}


# ---------------- Access control ----------------
class TestAccessControl:
    def test_parent_chat_forbidden(self, parent_headers):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/chat",
            headers=parent_headers,
            json={"message": "Hi"},
            timeout=30,
        )
        assert r.status_code == 403, f"Expected 403 for parent, got {r.status_code}: {r.text}"

    def test_athlete_chat_forbidden(self, athlete_headers):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/chat",
            headers=athlete_headers,
            json={"message": "Hi"},
            timeout=30,
        )
        assert r.status_code == 403, f"Expected 403 for athlete, got {r.status_code}: {r.text}"

    def test_parent_flyer_forbidden(self, parent_headers):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/flyer",
            headers=parent_headers,
            json={"event_type": "tryouts", "title": "Test"},
            timeout=30,
        )
        assert r.status_code == 403

    def test_parent_history_forbidden(self, parent_headers):
        r = requests.get(
            f"{BASE_URL}/api/team/coach-ai/history?conversation_id=abc",
            headers=parent_headers,
            timeout=30,
        )
        assert r.status_code == 403


# ---------------- Chat flow ----------------
class TestChat:
    conversation_id = None

    def test_chat_cheer_question(self, coach_headers):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/chat",
            headers=coach_headers,
            json={"message": "Give me two drills for a cleaner toe touch"},
            timeout=60,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "answer" in data and data["answer"], "No answer returned"
        assert "conversation_id" in data and data["conversation_id"], "No conversation_id"
        # It should NOT be the decline message for an on-topic question
        assert DECLINE_SNIPPET not in data["answer"], (
            f"On-topic question was declined: {data['answer'][:200]}"
        )
        TestChat.conversation_id = data["conversation_id"]

    def test_chat_off_topic_decline(self, coach_headers):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/chat",
            headers=coach_headers,
            json={"message": "What are good tax strategies for my small business?"},
            timeout=60,
        )
        assert r.status_code == 200
        data = r.json()
        assert DECLINE_SNIPPET in data["answer"], (
            f"Off-topic message was NOT declined. Answer: {data['answer'][:300]}"
        )

    def test_chat_history(self, coach_headers):
        assert TestChat.conversation_id, "Prior chat test must run first"
        # tiny delay to make sure inserts are visible
        time.sleep(0.5)
        r = requests.get(
            f"{BASE_URL}/api/team/coach-ai/history",
            headers=coach_headers,
            params={"conversation_id": TestChat.conversation_id},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        msgs = data.get("messages", [])
        assert len(msgs) >= 2, f"Expected >=2 messages in history, got {len(msgs)}"
        roles = [m["role"] for m in msgs]
        assert "user" in roles and "assistant" in roles, f"Missing role types: {roles}"
        # First message stored should be the user's question
        assert msgs[0]["role"] == "user"

    def test_chat_empty_message_rejected(self, coach_headers):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/chat",
            headers=coach_headers,
            json={"message": "   "},
            timeout=30,
        )
        assert r.status_code == 400


# ---------------- Flyer ----------------
class TestFlyer:
    def test_flyer_returns_402_budget_exhausted(self, coach_headers):
        """Emergent Universal Key budget is currently exhausted — endpoint
        must return HTTP 402 (not 500) with a clear balance message."""
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/flyer",
            headers=coach_headers,
            json={"event_type": "tryouts", "title": "Test Tryouts"},
            timeout=120,
        )
        # Accept 402 (budget) as the expected state. Also tolerate 200 if
        # budget happens to have been refilled.
        assert r.status_code in (402, 200), (
            f"Expected 402 (budget) or 200, got {r.status_code}: {r.text[:400]}"
        )
        if r.status_code == 402:
            detail = (r.json().get("detail") or "").lower()
            assert "universal key" in detail and ("balance" in detail or "too low" in detail), (
                f"402 message should mention Universal Key balance: {detail}"
            )

    def test_flyer_missing_title_400(self, coach_headers):
        r = requests.post(
            f"{BASE_URL}/api/team/coach-ai/flyer",
            headers=coach_headers,
            json={"event_type": "tryouts"},
            timeout=30,
        )
        assert r.status_code == 400
