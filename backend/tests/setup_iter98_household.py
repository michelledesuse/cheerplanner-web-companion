"""Setup helper: create A + B accounts, join household, seed activity.
Prints credentials for the browser to log in as B and verify banner.
"""
import os, time, sys, json
import requests

BASE = os.environ.get("EXPO_BACKEND_URL", "https://event-planner-394.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ts = int(time.time())
A_EMAIL = f"iter98_ownera_{ts}@example.com"
B_EMAIL = f"iter98_memberb_{ts}@example.com"
PW = "Test2026Pass!"


def signup(email, name):
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": PW, "name": name})
    r.raise_for_status()
    return r.json()["access_token"]


def h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def main():
    ta = signup(A_EMAIL, "Owner A")
    tb = signup(B_EMAIL, "Member B")

    # A generates invite
    r = requests.post(f"{API}/household/invite", headers=h(ta))
    r.raise_for_status()
    code = r.json()["code"]
    print("Invite code:", code)

    # B joins
    r = requests.post(f"{API}/household/join", headers=h(tb), json={"code": code})
    r.raise_for_status()
    print("B joined:", r.json())

    # A creates a competition
    r = requests.post(
        f"{API}/competitions",
        headers=h(ta),
        json={"name": "ITER98 State Championship", "event_date": "2026-06-15", "location": "Dallas"},
    )
    r.raise_for_status()
    comp = r.json()
    print("Comp created:", comp["id"], comp["name"])

    # A creates a schedule event
    r = requests.post(
        f"{API}/schedule",
        headers=h(ta),
        json={"title": "ITER98 Practice", "date": "2026-06-10", "start_time": "18:00", "end_time": "20:00", "event_type": "practice"},
    )
    r.raise_for_status()
    ev = r.json()
    print("Event created:", ev)

    # B checks activity
    r = requests.get(f"{API}/activity", headers=h(tb))
    r.raise_for_status()
    print("B activity items:", json.dumps(r.json(), indent=2)[:800])

    # Emit credentials for the browser script
    creds = {"a_email": A_EMAIL, "b_email": B_EMAIL, "password": PW, "comp_id": comp["id"]}
    with open("/tmp/iter98_creds.json", "w") as f:
        json.dump(creds, f)
    print("CREDS:", creds)


if __name__ == "__main__":
    main()
