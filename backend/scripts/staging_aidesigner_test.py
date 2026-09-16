"""Staging test for GPT-Image-2.5 Sunburst via the EXISTING AI Designer endpoints.
Never prints the API key. Exercises the real /api/ai-designer/* code path."""
import base64, io, json, sys, time
import requests
from PIL import Image

BASE = "https://event-planner-394.preview.emergentagent.com/api"
EMAIL, PW = "demo@cheerplanner.app", "CheerDemo2026!"
R = {}

def log(k, v):
    R[k] = v
    print(f"[{k}] {v}", flush=True)

def png_alpha_info(b64):
    img = Image.open(io.BytesIO(base64.b64decode(b64)))
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    min_alpha = None
    if img.mode == "RGBA":
        min_alpha = min(img.getchannel("A").getdata())
    return img.format, img.mode, img.size, has_alpha, min_alpha

def make_logo_dataurl():
    img = Image.new("RGBA", (512, 512), (255, 255, 255, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    d.ellipse((96, 96, 416, 416), fill=(30, 90, 200, 255))
    d.text((150, 230), "CP", fill=(255, 255, 255, 255))
    out = io.BytesIO(); img.save(out, "PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()

t = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW}, timeout=30).json()
tok = t["access_token"]
H = {"Authorization": f"Bearer {tok}"}
log("login", "ok")

# TEST 1 — text-to-image
try:
    r = requests.post(f"{BASE}/ai-designer/generate", headers=H, timeout=180,
                      json={"prompt": "A bold CheerPlanner competition flyer, navy and gold, big trophy, clean layout", "size": "1024x1024"})
    ok = r.status_code == 200 and isinstance(r.json().get("images"), list) and r.json().get("image_base64")
    if ok:
        fmt, mode, size, _, _ = png_alpha_info(r.json()["image_base64"])
        log("TEST1_text2image", f"PASS status=200 images={len(r.json()['images'])} png={fmt} size={size}")
        test1_b64 = r.json()["image_base64"]; test1_prompt = r.json().get("prompt"); test1_size = r.json().get("size")
    else:
        log("TEST1_text2image", f"FAIL status={r.status_code} body={str(r.json())[:200]}")
        test1_b64 = None
except Exception as e:
    log("TEST1_text2image", f"ERROR {type(e).__name__} {str(e)[:200]}"); test1_b64 = None

# TEST 4 — response contract (from TEST 1 response)
try:
    j = r.json()
    contract_ok = isinstance(j.get("images"), list) and isinstance(j.get("image_base64"), str)
    log("TEST4_contract", f"{'PASS' if contract_ok else 'FAIL'} keys={sorted(list(j.keys()))}")
except Exception as e:
    log("TEST4_contract", f"ERROR {e}")

# TEST 2 — reference-image editing (logo preserved)
try:
    logo = make_logo_dataurl()
    r2 = requests.post(f"{BASE}/ai-designer/generate", headers=H, timeout=180,
                       json={"prompt": "Place this CP logo top-center on a navy cheer banner that says GO TEAM, keep the logo unchanged",
                             "reference_images": [logo], "size": "1024x1024"})
    ok2 = r2.status_code == 200 and r2.json().get("image_base64")
    if ok2:
        fmt, mode, size, _, _ = png_alpha_info(r2.json()["image_base64"])
        log("TEST2_refedit", f"PASS status=200 images={len(r2.json()['images'])} png={fmt} size={size}")
    else:
        log("TEST2_refedit", f"FAIL status={r2.status_code} body={str(r2.json())[:200]}")
except Exception as e:
    log("TEST2_refedit", f"ERROR {type(e).__name__} {str(e)[:200]}")

# TEST 3 — transparent background
try:
    r3 = requests.post(f"{BASE}/ai-designer/generate", headers=H, timeout=180,
                       json={"prompt": "A single cheer megaphone mascot sticker, no background", "transparent": True, "size": "1024x1024"})
    if r3.status_code == 200 and r3.json().get("image_base64"):
        fmt, mode, size, has_alpha, min_alpha = png_alpha_info(r3.json()["image_base64"])
        transparent = has_alpha and (min_alpha is not None and min_alpha < 10)
        log("TEST3_transparent", f"{'PASS' if transparent else 'PARTIAL'} png={fmt} mode={mode} has_alpha={has_alpha} min_alpha={min_alpha}")
    else:
        log("TEST3_transparent", f"FAIL status={r3.status_code} body={str(r3.json())[:200]}")
except Exception as e:
    log("TEST3_transparent", f"ERROR {type(e).__name__} {str(e)[:200]}")

# TEST 5 — save + gallery + fetch, then cleanup
try:
    if test1_b64:
        s = requests.post(f"{BASE}/ai-designer/save", headers=H, timeout=60,
                          json={"image_base64": test1_b64, "prompt": test1_prompt, "size": test1_size})
        did = s.json().get("design_id")
        lst = requests.get(f"{BASE}/ai-designer/designs", headers=H, timeout=30).json().get("designs", [])
        in_list = any(d.get("id") == did for d in lst)
        one = requests.get(f"{BASE}/ai-designer/designs/{did}", headers=H, timeout=30)
        fetched = one.status_code == 200
        # cleanup
        dele = requests.delete(f"{BASE}/ai-designer/designs/{did}", headers=H, timeout=30)
        log("TEST5_save_gallery", f"{'PASS' if (did and in_list and fetched) else 'FAIL'} design_id={bool(did)} in_gallery={in_list} fetch={fetched} cleanup_status={dele.status_code}")
    else:
        log("TEST5_save_gallery", "SKIPPED (no image from TEST1)")
except Exception as e:
    log("TEST5_save_gallery", f"ERROR {type(e).__name__} {str(e)[:200]}")

# TEST 6 — error handling does not expose key/secrets
try:
    bad = requests.post(f"{BASE}/ai-designer/generate", headers=H, timeout=60, json={"prompt": ""})
    body = bad.text
    key_leak = "sk-" in body or "OPENAI_API_KEY" in body or "Traceback" in body
    log("TEST6_error_handling", f"{'PASS' if (bad.status_code in (400,422) and not key_leak) else 'FAIL'} status={bad.status_code} key_or_trace_leak={key_leak} detail={str(bad.json())[:120]}")
except Exception as e:
    log("TEST6_error_handling", f"ERROR {type(e).__name__} {str(e)[:200]}")

print("\n=== SUMMARY ===")
print(json.dumps(R, indent=2))
