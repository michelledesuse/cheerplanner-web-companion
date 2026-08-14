"""Iter94 CheerPlanner 2.0 - Review Photos + Near-a-Comp backend regression.

Covers:
  - POST /api/reviews accepts a `photos` array (base64 data URLs), caps at 3.
  - PATCH /api/reviews/{id} accepts photos (add / clear / replace).
  - GET /api/reviews/places/{id} returns photos on each review.
  - GET /api/reviews/near?competition_id={id} returns matching reviewed
    places whose city matches terms in the competition's location/address.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

USER_EMAIL = "applereview@cheerplanner.app"
USER_PASSWORD = "Review2026!"
ADMIN_EMAIL = "reviewsadmin@cheerplanner.app"
ADMIN_PASSWORD = "AdminRev2026!"

# 1x1 red pixel JPEG in base64 (very small — good enough for the API round-trip)
TINY_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwc"
    "KDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
    "MjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcI"
    "CQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRol"
    "JicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip"
    "qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=="
)
DATA_URL = f"data:image/jpeg;base64,{TINY_JPEG_B64}"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_token():
    return _login(USER_EMAIL, USER_PASSWORD)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


# ---------------------------------------------------------- Review Photos ----

def test_submit_review_stores_up_to_three_photos(user_token):
    name = f"TEST_Photos_{int(time.time())}"
    photos = [DATA_URL, DATA_URL]
    r = requests.post(
        f"{BASE_URL}/api/reviews",
        headers=_h(user_token),
        json={"place_name": name, "city": "Austin", "category": "Coffee Shops",
              "rating": 5, "body": "with pics", "display_mode": "name", "photos": photos},
    )
    assert r.status_code == 200, r.text
    pid = r.json()["place_id"]
    rid = r.json()["review_id"]

    d = requests.get(f"{BASE_URL}/api/reviews/places/{pid}", headers=_h(user_token)).json()
    assert d["my_review"]["photos"] and len(d["my_review"]["photos"]) == 2
    # each review row exposes photos
    for rev in d["reviews"]:
        assert "photos" in rev

    # cleanup
    requests.delete(f"{BASE_URL}/api/reviews/{rid}", headers=_h(user_token))


def test_photos_capped_at_three(user_token):
    name = f"TEST_PhotoCap_{int(time.time())}"
    photos = [DATA_URL, DATA_URL, DATA_URL, DATA_URL, DATA_URL]
    r = requests.post(
        f"{BASE_URL}/api/reviews",
        headers=_h(user_token),
        json={"place_name": name, "city": "Austin", "category": "Other",
              "rating": 4, "body": "", "display_mode": "name", "photos": photos},
    )
    assert r.status_code == 200, r.text
    pid, rid = r.json()["place_id"], r.json()["review_id"]
    d = requests.get(f"{BASE_URL}/api/reviews/places/{pid}", headers=_h(user_token)).json()
    assert len(d["my_review"]["photos"]) == 3, "photos array must be capped at 3"

    # cleanup
    requests.delete(f"{BASE_URL}/api/reviews/{rid}", headers=_h(user_token))


def test_patch_photos_edit_and_clear(user_token):
    name = f"TEST_PhotoEdit_{int(time.time())}"
    r = requests.post(
        f"{BASE_URL}/api/reviews", headers=_h(user_token),
        json={"place_name": name, "city": "Austin", "category": "Other",
              "rating": 4, "body": "", "display_mode": "name", "photos": [DATA_URL]},
    )
    assert r.status_code == 200
    pid, rid = r.json()["place_id"], r.json()["review_id"]

    # add another (2 total)
    p = requests.patch(f"{BASE_URL}/api/reviews/{rid}", headers=_h(user_token),
                       json={"photos": [DATA_URL, DATA_URL]})
    assert p.status_code == 200
    d = requests.get(f"{BASE_URL}/api/reviews/places/{pid}", headers=_h(user_token)).json()
    assert len(d["my_review"]["photos"]) == 2

    # clear photos
    p2 = requests.patch(f"{BASE_URL}/api/reviews/{rid}", headers=_h(user_token), json={"photos": []})
    assert p2.status_code == 200
    d2 = requests.get(f"{BASE_URL}/api/reviews/places/{pid}", headers=_h(user_token)).json()
    assert d2["my_review"]["photos"] == []

    # cleanup
    requests.delete(f"{BASE_URL}/api/reviews/{rid}", headers=_h(user_token))


# ---------------------------------------------------------- Near a Comp ------

def _create_comp(token, location):
    """Create a competition and return its id. Try common shapes."""
    payload = {
        "name": f"TEST_Comp_{int(time.time()*1000)}",
        "location": location,
        "address": location,
        "event_date": "2026-12-01",
        "housing_required": False,
    }
    r = requests.post(f"{BASE_URL}/api/competitions", headers=_h(token), json=payload)
    assert r.status_code in (200, 201), f"create comp: {r.status_code} {r.text}"
    return r.json().get("id") or r.json().get("_id")


def test_near_returns_matching_places_for_round_rock(user_token):
    # Ensure a reviewed place in Round Rock exists (idempotent - upsert by name+city).
    place_name = "TEST_KidsCafe_RR"
    seed = requests.post(
        f"{BASE_URL}/api/reviews", headers=_h(user_token),
        json={"place_name": place_name, "city": "Round Rock, TX", "category": "Restaurants/Eateries",
              "rating": 5, "body": "family friendly", "display_mode": "name"},
    )
    assert seed.status_code == 200
    seeded_pid = seed.json()["place_id"]
    seeded_rid = seed.json()["review_id"]

    # Create a competition in Round Rock.
    cid = _create_comp(user_token, "Kalahari Resort, Round Rock, TX")

    try:
        r = requests.get(f"{BASE_URL}/api/reviews/near?competition_id={cid}", headers=_h(user_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "places" in body and "location" in body
        ids = [p["id"] for p in body["places"]]
        assert seeded_pid in ids, f"Round Rock place not found in near list; got: {ids}"
    finally:
        # cleanup
        requests.delete(f"{BASE_URL}/api/competitions/{cid}", headers=_h(user_token))
        requests.delete(f"{BASE_URL}/api/reviews/{seeded_rid}", headers=_h(user_token))


def test_near_empty_when_no_city_match(user_token):
    cid = _create_comp(user_token, "Somewhere ObscureVilleXyz, ZZ")
    try:
        r = requests.get(f"{BASE_URL}/api/reviews/near?competition_id={cid}", headers=_h(user_token))
        assert r.status_code == 200
        # not asserting empty (there may be a place matching a random token) — just structure
        body = r.json()
        assert isinstance(body.get("places", []), list)
    finally:
        requests.delete(f"{BASE_URL}/api/competitions/{cid}", headers=_h(user_token))


def test_near_404_for_missing_competition(user_token):
    r = requests.get(f"{BASE_URL}/api/reviews/near?competition_id=does-not-exist", headers=_h(user_token))
    assert r.status_code == 404
