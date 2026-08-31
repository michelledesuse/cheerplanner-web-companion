"""Cleanup helper: removes TEST_iter107_* skills created by the test run."""
import os, requests
with open("/app/frontend/.env") as f:
    for l in f:
        if l.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE = l.split("=", 1)[1].strip().strip('"').rstrip("/")
tok = requests.post(f"{BASE}/api/auth/login", json={"email": "coach.casey@cheerplanner.app", "password": "CheerDemo2026!"}).json()["access_token"]
h = {"Authorization": f"Bearer {tok}"}
data = requests.get(f"{BASE}/api/team/scouting/skills", headers=h).json()["categories"]
removed = 0
for cat, arr in data.items():
    for s in arr:
        if str(s.get("name", "")).startswith("TEST_iter107_"):
            r = requests.delete(f"{BASE}/api/team/scouting/skills/{s['id']}", headers=h)
            if r.status_code == 200:
                removed += 1
print(f"Removed {removed} TEST_iter107_ skills")
