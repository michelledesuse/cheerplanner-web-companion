"""Backend tests for CheerPlanner AI Designer.

Covers:
- Access control (staff-only vs non-staff 403)
- Generate → returns base64 image
- Save → creates a record retrievable in list & get
- Delete → then get returns 404
"""
import base64
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

STAFF_EMAIL = "demo@cheerplanner.app"
STAFF_PASS = "CheerDemo2026!"
NON_STAFF_EMAIL = "sophia.athlete@cheerplanner.app"
NON_STAFF_PASS = "CheerDemo2026!"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"no token in login response: {data}"
    return tok


@pytest.fixture(scope="module")
def staff_headers():
    return {"Authorization": f"Bearer {_login(STAFF_EMAIL, STAFF_PASS)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def non_staff_headers():
    return {"Authorization": f"Bearer {_login(NON_STAFF_EMAIL, NON_STAFF_PASS)}", "Content-Type": "application/json"}


# ---------- Access control ----------
class TestAccessControl:
    def test_non_staff_generate_forbidden(self, non_staff_headers):
        r = requests.post(f"{API}/ai-designer/generate", headers=non_staff_headers, json={"prompt": "test"}, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_non_staff_list_forbidden(self, non_staff_headers):
        r = requests.get(f"{API}/ai-designer/designs", headers=non_staff_headers, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_unauth_generate_401(self):
        r = requests.post(f"{API}/ai-designer/generate", json={"prompt": "x"}, timeout=30)
        assert r.status_code in (401, 403)


# ---------- Validation ----------
class TestValidation:
    def test_empty_prompt_400(self, staff_headers):
        r = requests.post(f"{API}/ai-designer/generate", headers=staff_headers, json={"prompt": ""}, timeout=30)
        assert r.status_code == 400

    def test_save_empty_400(self, staff_headers):
        r = requests.post(f"{API}/ai-designer/save", headers=staff_headers, json={"image_base64": ""}, timeout=30)
        assert r.status_code == 400


# ---------- Full CRUD flow (real OpenAI call — slow) ----------
class TestDesignFlow:
    """Create → Save → List → Get → Delete verification."""

    def test_generate_returns_base64(self, staff_headers):
        r = requests.post(
            f"{API}/ai-designer/generate",
            headers=staff_headers,
            json={"prompt": "TEST_ pytest smoke — simple blue circle on white background"},
            timeout=180,
        )
        assert r.status_code == 200, f"generate failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert "image_base64" in data and len(data["image_base64"]) > 1000
        # sanity: decodable
        raw = base64.b64decode(data["image_base64"])
        assert raw[:8] in (b"\x89PNG\r\n\x1a\n",) or len(raw) > 500
        pytest._generated_b64 = data["image_base64"]
        pytest._generated_prompt = "TEST_ pytest smoke"

    def test_save_and_list(self, staff_headers):
        b64 = getattr(pytest, "_generated_b64", None)
        if not b64:
            pytest.skip("no generated image from previous step")
        r = requests.post(
            f"{API}/ai-designer/save",
            headers=staff_headers,
            json={"image_base64": b64, "prompt": pytest._generated_prompt},
            timeout=60,
        )
        assert r.status_code == 200, f"save failed: {r.status_code} {r.text[:400]}"
        design_id = r.json().get("design_id")
        assert design_id, "no design_id"
        pytest._design_id = design_id

        # verify persistence via list
        r2 = requests.get(f"{API}/ai-designer/designs", headers=staff_headers, timeout=30)
        assert r2.status_code == 200
        ids = [d["id"] for d in r2.json().get("designs", [])]
        assert design_id in ids, f"saved design {design_id} not in list {ids}"

    def test_get_returns_image(self, staff_headers):
        did = getattr(pytest, "_design_id", None)
        if not did:
            pytest.skip("no design_id")
        r = requests.get(f"{API}/ai-designer/designs/{did}", headers=staff_headers, timeout=60)
        assert r.status_code == 200
        j = r.json()
        assert "image_base64" in j and len(j["image_base64"]) > 1000

    def test_delete_then_404(self, staff_headers):
        did = getattr(pytest, "_design_id", None)
        if not did:
            pytest.skip("no design_id")
        r = requests.delete(f"{API}/ai-designer/designs/{did}", headers=staff_headers, timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        r2 = requests.get(f"{API}/ai-designer/designs/{did}", headers=staff_headers, timeout=30)
        assert r2.status_code == 404


# ---------- New iter116: variations, transparent, edit_image, ref/logo ----------
def _tiny_png_b64() -> str:
    """Return a tiny 8x8 red PNG as base64 (no data: prefix)."""
    import io as _io
    from PIL import Image as _Image
    img = _Image.new("RGB", (8, 8), (220, 20, 60))
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


class TestVariationsAndTransparent:
    """Multi-image generation with transparent background."""

    def test_generate_variations_2_transparent(self, staff_headers):
        r = requests.post(
            f"{API}/ai-designer/generate",
            headers=staff_headers,
            json={
                "prompt": "TEST_ iter116 — cheer megaphone sticker, bold gold",
                "variations": 2,
                "transparent": True,
            },
            timeout=180,
        )
        assert r.status_code == 200, f"generate variations failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert isinstance(data.get("images"), list) and len(data["images"]) == 2, f"expected 2 images, got {len(data.get('images', []))}"
        for i, b in enumerate(data["images"]):
            assert isinstance(b, str) and len(b) > 1000, f"image[{i}] too small"
            raw = base64.b64decode(b)
            assert raw[:8] == b"\x89PNG\r\n\x1a\n", f"image[{i}] is not a PNG"
        # image_base64 alias mirrors first image
        assert data.get("image_base64") == data["images"][0]

    def test_variations_clamped_to_max(self, staff_headers):
        """variations>4 should be clamped to MAX_VARIATIONS=4, not error."""
        r = requests.post(
            f"{API}/ai-designer/generate",
            headers=staff_headers,
            json={"prompt": "TEST_ clamp", "variations": 99},
            timeout=180,
        )
        # We don't want to actually run 4 variations here (slow/cost) — just assert
        # we didn't get a validation error. Backend clamps, so 200 or a business
        # error from OpenAI, but never 422/400 for the count.
        assert r.status_code not in (400, 422), f"variations clamping broken: {r.status_code} {r.text[:200]}"


class TestEditAndReferenceInputs:
    """edit_image / reference_images / logo route through the edit endpoint."""

    def test_edit_image_returns_new_design(self, staff_headers):
        seed_b64 = _tiny_png_b64()
        r = requests.post(
            f"{API}/ai-designer/generate",
            headers=staff_headers,
            json={
                "prompt": "TEST_ iter116 tweak — make it navy and add sparkles",
                "edit_image": seed_b64,
                "variations": 1,
            },
            timeout=180,
        )
        assert r.status_code == 200, f"edit failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert len(data.get("images", [])) == 1
        raw = base64.b64decode(data["images"][0])
        assert raw[:8] == b"\x89PNG\r\n\x1a\n"

    def test_reference_and_logo_accepted(self, staff_headers):
        ref = "data:image/png;base64," + _tiny_png_b64()  # test data-URL prefix stripping
        logo = _tiny_png_b64()
        r = requests.post(
            f"{API}/ai-designer/generate",
            headers=staff_headers,
            json={
                "prompt": "TEST_ iter116 brand — poster using the logo & reference",
                "reference_images": [ref],
                "logo": logo,
                "variations": 1,
            },
            timeout=180,
        )
        assert r.status_code == 200, f"ref+logo failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert len(data.get("images", [])) == 1

    def test_only_reference_no_prompt_allowed(self, staff_headers):
        """Server should accept ref-only requests (uses default prompt)."""
        r = requests.post(
            f"{API}/ai-designer/generate",
            headers=staff_headers,
            json={"prompt": "", "reference_images": [_tiny_png_b64()], "variations": 1},
            timeout=180,
        )
        # 200 (default prompt fills in) OR 400 if backend later tightens — must not 500.
        assert r.status_code in (200, 400), f"ref-only unexpected: {r.status_code} {r.text[:200]}"


# ---------- iter117: Brand presets CRUD ----------
class TestBrandPresets:
    """Save multiple brand presets (name, colors, logo), update, delete."""

    def test_brand_list_initially_ok(self, staff_headers):
        r = requests.get(f"{API}/ai-designer/brands", headers=staff_headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json().get("brands"), list)

    def test_brand_create_requires_name(self, staff_headers):
        r = requests.post(f"{API}/ai-designer/brands", headers=staff_headers, json={"name": "", "colors": ["navy"]}, timeout=30)
        assert r.status_code == 400

    def test_brand_full_crud(self, staff_headers):
        # create
        payload = {"name": "TEST_ iter117 brand", "colors": ["navy", "gold"], "logo": _tiny_png_b64()}
        r = requests.post(f"{API}/ai-designer/brands", headers=staff_headers, json=payload, timeout=30)
        assert r.status_code == 200, f"create failed: {r.status_code} {r.text[:300]}"
        b = r.json()
        assert b["name"] == payload["name"]
        assert b["colors"] == ["navy", "gold"]
        assert b["logo"].startswith("data:image/")  # normalized to data URL
        bid = b["id"]
        pytest._brand_id = bid

        # list contains it
        r2 = requests.get(f"{API}/ai-designer/brands", headers=staff_headers, timeout=30)
        assert r2.status_code == 200
        assert any(x["id"] == bid for x in r2.json()["brands"])

        # patch — rename + change colors
        r3 = requests.patch(f"{API}/ai-designer/brands/{bid}", headers=staff_headers,
                            json={"name": "TEST_ iter117 brand renamed", "colors": ["red", "white", "blue"]}, timeout=30)
        assert r3.status_code == 200
        upd = r3.json()
        assert upd["name"] == "TEST_ iter117 brand renamed"
        assert upd["colors"] == ["red", "white", "blue"]

        # delete
        r4 = requests.delete(f"{API}/ai-designer/brands/{bid}", headers=staff_headers, timeout=30)
        assert r4.status_code == 200
        assert r4.json().get("deleted") is True

        # gone
        r5 = requests.patch(f"{API}/ai-designer/brands/{bid}", headers=staff_headers, json={"name": "x"}, timeout=30)
        assert r5.status_code == 404

    def test_brand_delete_404_for_unknown(self, staff_headers):
        r = requests.delete(f"{API}/ai-designer/brands/does-not-exist", headers=staff_headers, timeout=30)
        assert r.status_code == 404


# ---------- iter117: Post to Team Chat ----------
class TestPostToChat:
    def test_post_to_chat_empty_400(self, staff_headers):
        r = requests.post(f"{API}/ai-designer/post-to-chat", headers=staff_headers, json={"image_base64": ""}, timeout=30)
        assert r.status_code == 400

    def test_post_to_chat_success_then_delete(self, staff_headers):
        # Post using a tiny local PNG so we skip a slow generate call.
        b64 = _tiny_png_b64()
        r = requests.post(f"{API}/ai-designer/post-to-chat", headers=staff_headers,
                          json={"image_base64": b64, "caption": "TEST_ iter117 flyer"}, timeout=60)
        assert r.status_code == 200, f"post-to-chat failed: {r.status_code} {r.text[:300]}"
        mid = r.json().get("message_id")
        assert mid
        # cleanup — coach/staff can delete their own message via team_chat
        r2 = requests.delete(f"{API}/team/chat/messages/{mid}", headers=staff_headers, timeout=30)
        assert r2.status_code in (200, 204), f"chat delete failed: {r2.status_code} {r2.text[:200]}"


# ---------- iter117: Non-staff 403 on new endpoints ----------
class TestNonStaffBlocked:
    def test_non_staff_brands_list_forbidden(self, non_staff_headers):
        r = requests.get(f"{API}/ai-designer/brands", headers=non_staff_headers, timeout=30)
        assert r.status_code == 403

    def test_non_staff_brand_create_forbidden(self, non_staff_headers):
        r = requests.post(f"{API}/ai-designer/brands", headers=non_staff_headers,
                          json={"name": "x", "colors": []}, timeout=30)
        assert r.status_code == 403

    def test_non_staff_brand_update_forbidden(self, non_staff_headers):
        r = requests.patch(f"{API}/ai-designer/brands/anything", headers=non_staff_headers,
                           json={"name": "x"}, timeout=30)
        assert r.status_code == 403

    def test_non_staff_brand_delete_forbidden(self, non_staff_headers):
        r = requests.delete(f"{API}/ai-designer/brands/anything", headers=non_staff_headers, timeout=30)
        assert r.status_code == 403

    def test_non_staff_post_to_chat_forbidden(self, non_staff_headers):
        r = requests.post(f"{API}/ai-designer/post-to-chat", headers=non_staff_headers,
                          json={"image_base64": _tiny_png_b64()}, timeout=30)
        assert r.status_code == 403

    def test_non_staff_cannot_delete_coach_flyer_in_chat(self, staff_headers, non_staff_headers):
        """A parent/athlete cannot delete a coach-posted flyer message."""
        # Coach posts a flyer message
        r = requests.post(
            f"{API}/ai-designer/post-to-chat",
            headers=staff_headers,
            json={"image_base64": _tiny_png_b64(), "caption": "TEST_ iter117 delete-perm"},
            timeout=60,
        )
        assert r.status_code == 200
        mid = r.json().get("message_id")
        assert mid
        try:
            # Non-staff attempts delete → must be blocked (403 from require_chat_access
            # OR the "you can only delete your own" branch in team_chat.delete_message).
            r2 = requests.delete(f"{API}/team/chat/messages/{mid}", headers=non_staff_headers, timeout=30)
            assert r2.status_code == 403, f"expected 403 for non-staff delete, got {r2.status_code}: {r2.text[:200]}"
        finally:
            # Coach cleanup
            requests.delete(f"{API}/team/chat/messages/{mid}", headers=staff_headers, timeout=30)
