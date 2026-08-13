"""Iter93 Community Reviews - backend regression (light re-confirm).
Main agent already curl-verified full happy path. This just sanity-checks the
public API surface used by the frontend UI flows: auth, categories, places
listing, review submit/edit/delete, flag, admin gating.
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


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_token():
    return _login(USER_EMAIL, USER_PASSWORD)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# Categories -----------------------------------------------------------------
def test_list_categories_defaults_present(user_token):
    r = requests.get(f"{BASE_URL}/api/reviews/categories", headers=_h(user_token))
    assert r.status_code == 200
    labels = [c["label"] for c in r.json()["categories"]]
    for expected in ["Restaurants/Eateries", "Coffee Shops", "Hotels/Lodging", "Other"]:
        assert expected in labels
    assert r.json().get("is_admin") in (True, False)


def test_add_category_regular_user(user_token):
    label = f"TEST_Cat_{int(time.time())}"
    r = requests.post(f"{BASE_URL}/api/reviews/categories", headers=_h(user_token), json={"label": label})
    assert r.status_code == 200
    assert r.json()["label"] == label
    # verify visible in list
    lst = requests.get(f"{BASE_URL}/api/reviews/categories", headers=_h(user_token)).json()["categories"]
    assert any(c["label"] == label for c in lst)


# Places / reviews -----------------------------------------------------------
def test_list_places_sort_and_filters(user_token):
    r = requests.get(f"{BASE_URL}/api/reviews/places?sort=top", headers=_h(user_token))
    assert r.status_code == 200
    assert isinstance(r.json()["places"], list)
    r2 = requests.get(f"{BASE_URL}/api/reviews/places?sort=reviews", headers=_h(user_token))
    r3 = requests.get(f"{BASE_URL}/api/reviews/places?sort=new", headers=_h(user_token))
    assert r2.status_code == 200 and r3.status_code == 200
    r4 = requests.get(f"{BASE_URL}/api/reviews/places?city=Dallas", headers=_h(user_token))
    assert r4.status_code == 200


def test_submit_edit_delete_review_flow(user_token):
    place_name = f"TEST_Place_{int(time.time())}"
    payload = {"place_name": place_name, "city": "Austin", "category": "Coffee Shops", "rating": 4, "body": "Solid spot", "display_mode": "name"}
    r = requests.post(f"{BASE_URL}/api/reviews", headers=_h(user_token), json=payload)
    assert r.status_code == 200, r.text
    place_id = r.json()["place_id"]
    review_id = r.json()["review_id"]

    # detail
    d = requests.get(f"{BASE_URL}/api/reviews/places/{place_id}", headers=_h(user_token)).json()
    assert d["place"]["review_count"] == 1
    assert d["my_review"]["rating"] == 4
    # ensure user_id not leaked
    for rev in d["reviews"]:
        assert "user_id" not in rev

    # resubmit same place -> upsert not duplicate
    r2 = requests.post(f"{BASE_URL}/api/reviews", headers=_h(user_token), json={**payload, "rating": 5, "body": "Even better"})
    assert r2.status_code == 200
    assert r2.json()["review_id"] == review_id
    d2 = requests.get(f"{BASE_URL}/api/reviews/places/{place_id}", headers=_h(user_token)).json()
    assert d2["place"]["review_count"] == 1
    assert d2["my_review"]["rating"] == 5

    # patch
    p = requests.patch(f"{BASE_URL}/api/reviews/{review_id}", headers=_h(user_token), json={"rating": 3, "body": "Meh"})
    assert p.status_code == 200

    # delete -> place should auto-remove since no other reviews
    d3 = requests.delete(f"{BASE_URL}/api/reviews/{review_id}", headers=_h(user_token))
    assert d3.status_code == 200
    gone = requests.get(f"{BASE_URL}/api/reviews/places/{place_id}", headers=_h(user_token))
    assert gone.status_code == 404


def test_display_name_anonymous_vs_name(user_token):
    place_name = f"TEST_Anon_{int(time.time())}"
    r = requests.post(f"{BASE_URL}/api/reviews", headers=_h(user_token), json={"place_name": place_name, "city": "Denver", "category": "Other", "rating": 4, "body": "anon test", "display_mode": "anonymous"})
    assert r.status_code == 200
    pid = r.json()["place_id"]
    rev_id = r.json()["review_id"]
    d = requests.get(f"{BASE_URL}/api/reviews/places/{pid}", headers=_h(user_token)).json()
    assert d["my_review"]["author_name"] == "Anonymous"
    # switch to name mode
    requests.patch(f"{BASE_URL}/api/reviews/{rev_id}", headers=_h(user_token), json={"display_mode": "name"})
    d2 = requests.get(f"{BASE_URL}/api/reviews/places/{pid}", headers=_h(user_token)).json()
    assert d2["my_review"]["author_name"] != "Anonymous"
    # cleanup
    requests.delete(f"{BASE_URL}/api/reviews/{rev_id}", headers=_h(user_token))


# Cross-account + flag -------------------------------------------------------
def test_cross_account_visibility_and_flag(user_token, admin_token):
    name = f"TEST_XAcc_{int(time.time())}"
    r = requests.post(f"{BASE_URL}/api/reviews", headers=_h(user_token), json={"place_name": name, "city": "Dallas", "category": "Restaurants/Eateries", "rating": 5, "body": "great", "display_mode": "name"})
    assert r.status_code == 200
    pid = r.json()["place_id"]
    rid = r.json()["review_id"]

    # admin sees the place
    lst = requests.get(f"{BASE_URL}/api/reviews/places?city=Dallas", headers=_h(admin_token)).json()["places"]
    assert any(p["id"] == pid for p in lst)

    # admin flags
    f = requests.post(f"{BASE_URL}/api/reviews/{rid}/flag", headers=_h(admin_token), json={"reason": "test-report"})
    assert f.status_code == 200

    flags = requests.get(f"{BASE_URL}/api/reviews/flags", headers=_h(admin_token))
    assert flags.status_code == 200
    ids = [x["review"]["id"] for x in flags.json()["flags"]]
    assert rid in ids

    # cleanup: admin can delete
    d = requests.delete(f"{BASE_URL}/api/reviews/{rid}", headers=_h(admin_token))
    assert d.status_code == 200


# Admin gating ---------------------------------------------------------------
def test_non_admin_forbidden_on_flags_and_merge(user_token):
    r = requests.get(f"{BASE_URL}/api/reviews/flags", headers=_h(user_token))
    assert r.status_code == 403
    r2 = requests.post(f"{BASE_URL}/api/reviews/places/does-not-matter/merge", headers=_h(user_token), json={"source_id": "x"})
    assert r2.status_code == 403


def test_admin_merge_flow(admin_token):
    a = requests.post(f"{BASE_URL}/api/reviews", headers=_h(admin_token), json={"place_name": f"TEST_MergeA_{int(time.time())}", "city": "Waco", "category": "Other", "rating": 4, "body": "a", "display_mode": "name"}).json()
    b = requests.post(f"{BASE_URL}/api/reviews", headers=_h(admin_token), json={"place_name": f"TEST_MergeB_{int(time.time())}", "city": "Waco", "category": "Other", "rating": 5, "body": "b", "display_mode": "name"}).json()
    # since same admin reviewed both, dedupe path exercised
    r = requests.post(f"{BASE_URL}/api/reviews/places/{a['place_id']}/merge", headers=_h(admin_token), json={"source_id": b["place_id"]})
    assert r.status_code == 200, r.text
    # b should be gone
    gone = requests.get(f"{BASE_URL}/api/reviews/places/{b['place_id']}", headers=_h(admin_token))
    assert gone.status_code == 404
    # cleanup the surviving review
    d = requests.get(f"{BASE_URL}/api/reviews/places/{a['place_id']}", headers=_h(admin_token)).json()
    if d.get("my_review"):
        requests.delete(f"{BASE_URL}/api/reviews/{d['my_review']['id']}", headers=_h(admin_token))
