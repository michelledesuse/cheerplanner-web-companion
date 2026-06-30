"""Tests for v2.2 bug fix: /api/calendar returns logo_image on team_meet / team_performance items."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
EMAIL = "applereview@cheerplanner.app"
PASSWORD = "Review2026!"


@pytest.fixture(scope="module")
def auth_token():
    assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def api_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def all_calendar_items(api_headers):
    """Aggregate calendar items spanning fall 2026 (Jul-Dec 2026)."""
    items = []
    for ym in ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]:
        y, m = ym.split("-")
        from calendar import monthrange
        last = monthrange(int(y), int(m))[1]
        start = f"{ym}-01"
        end = f"{ym}-{last:02d}"
        r = requests.get(f"{BASE_URL}/api/calendar?start={start}&end={end}", headers=api_headers, timeout=30)
        assert r.status_code == 200, f"calendar feed failed for {ym}: {r.status_code} {r.text}"
        items.extend(r.json().get("items", []))
    return items


class TestCalendarTeamLogo:
    def test_calendar_endpoint_returns_items(self, all_calendar_items):
        assert isinstance(all_calendar_items, list)
        assert len(all_calendar_items) > 0, "No calendar items found in fall 2026"

    def test_team_meet_items_present(self, all_calendar_items):
        team_meet = [i for i in all_calendar_items if i.get("kind") == "team_meet"]
        team_perf = [i for i in all_calendar_items if i.get("kind") == "team_performance"]
        assert len(team_meet) + len(team_perf) > 0, "No team_meet or team_performance items in fall 2026"

    def test_team_meet_items_include_logo_image_field(self, all_calendar_items):
        """Every team_meet/team_performance item MUST include `logo_image` key (may be None for teams w/o logos)."""
        rel = [i for i in all_calendar_items if i.get("kind") in ("team_meet", "team_performance")]
        assert rel, "No relevant items to assert on"
        missing = [i for i in rel if "logo_image" not in i]
        assert not missing, f"{len(missing)} team_meet/perf items missing logo_image key. Sample: {missing[:2]}"

    def test_at_least_one_team_meet_or_perf_has_logo(self, all_calendar_items, api_headers):
        """Senior Elite Coed 5 has a logo. At least one team_meet/team_performance should carry a non-empty logo_image."""
        rel = [i for i in all_calendar_items if i.get("kind") in ("team_meet", "team_performance")]
        with_logo = [i for i in rel if i.get("logo_image")]
        # Diagnostic: confirm the team logo actually exists
        tr = requests.get(f"{BASE_URL}/api/teams", headers=api_headers, timeout=20)
        teams = tr.json() if tr.status_code == 200 else []
        team_with_logo = [t for t in teams if t.get("logo_image")]
        assert team_with_logo, f"Pre-condition failure: no team has logo_image. teams response: {teams}"
        assert with_logo, (
            f"Expected at least one team_meet/team_performance item to include a non-empty logo_image. "
            f"team_meet/perf items: {len(rel)}, teams_with_logo names: {[t.get('name') for t in team_with_logo]}"
        )

    def test_other_kinds_do_not_carry_logo_image(self, all_calendar_items):
        """Regression: kinds other than team_meet/team_performance should not include a truthy logo_image."""
        other = [
            i for i in all_calendar_items
            if i.get("kind") not in ("team_meet", "team_performance") and i.get("logo_image")
        ]
        assert not other, f"Non-team items unexpectedly carry logo_image: {other[:3]}"

    def test_team_to_watch_has_no_logo_image(self, all_calendar_items):
        watch = [i for i in all_calendar_items if i.get("kind") == "team_to_watch"]
        for w in watch:
            assert not w.get("logo_image"), f"team_to_watch should not have logo_image: {w}"

    def test_team_meet_link_targets_competition(self, all_calendar_items):
        rel = [i for i in all_calendar_items if i.get("kind") in ("team_meet", "team_performance")]
        for i in rel:
            link = i.get("link") or ""
            assert link.startswith("/competitions/"), f"team item link should target competition: {i}"
