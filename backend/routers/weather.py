"""Weather forecasts for competitions & events, powered by Open-Meteo (free, no
API key). The frontend never calls Open-Meteo directly — it hits this endpoint
with a free-text `location` and a `date`, and we:

  1. geocode the location -> lat/lon (cached 24h),
  2. fetch the daily forecast (cached ~1h),
  3. return a compact, Fahrenheit result the UI can render as a small badge.

Everything degrades gracefully: no location, un-geocodable location, or a date
outside the 16-day forecast window all return `available: false` with a reason
so the client can hide the badge or show a friendly hint (never an error).
"""
import re
from datetime import datetime, timezone, timedelta, date as date_cls
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Query

from core.db import db
from core.models import utcnow_iso
from core.security import get_current_user

router = APIRouter(prefix="/api")

_client: Optional[httpx.AsyncClient] = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0))
    return _client


# WMO weather code -> (human label, emoji)
WMO = {
    0: ("Clear sky", "☀️"), 1: ("Mainly clear", "🌤️"), 2: ("Partly cloudy", "⛅"),
    3: ("Overcast", "☁️"), 45: ("Fog", "🌫️"), 48: ("Rime fog", "🌫️"),
    51: ("Light drizzle", "🌦️"), 53: ("Drizzle", "🌦️"), 55: ("Heavy drizzle", "🌧️"),
    56: ("Freezing drizzle", "🌧️"), 57: ("Freezing drizzle", "🌧️"),
    61: ("Light rain", "🌦️"), 63: ("Rain", "🌧️"), 65: ("Heavy rain", "🌧️"),
    66: ("Freezing rain", "🌧️"), 67: ("Freezing rain", "🌧️"),
    71: ("Light snow", "🌨️"), 73: ("Snow", "🌨️"), 75: ("Heavy snow", "❄️"),
    77: ("Snow grains", "🌨️"), 80: ("Showers", "🌦️"), 81: ("Showers", "🌧️"),
    82: ("Heavy showers", "⛈️"), 85: ("Snow showers", "🌨️"), 86: ("Snow showers", "❄️"),
    95: ("Thunderstorm", "⛈️"), 96: ("Thunderstorm + hail", "⛈️"), 99: ("Thunderstorm + hail", "⛈️"),
}

_STATES = set("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt "
              "ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split())


def _geocode_candidates(location: str) -> list[str]:
    """Build an ordered list of query strings to try against the geocoder.

    Free-text venue strings ("Kalahari Resort, Round Rock, TX 78665") don't
    geocode well as-is, so we try the comma parts (a city usually sits just
    before the state) before falling back to the whole string.
    """
    cands: list[str] = []
    seen = set()

    def add(s: str):
        s = re.sub(r"\s+", " ", (s or "").strip()).strip(" ,")
        # strip a trailing ZIP
        s = re.sub(r"\s+\d{5}(-\d{4})?$", "", s).strip()
        key = s.lower()
        if len(s) >= 3 and key not in seen and key not in _STATES and not s.isdigit():
            seen.add(key)
            cands.append(s)

    parts = [p for p in re.split(r"[,\n]", location) if p.strip()]
    # prefer the part before the last (usually the city), then remaining parts
    if len(parts) >= 2:
        add(parts[-2])
    for p in reversed(parts):
        add(p)
    add(location)
    return cands[:5]


async def _geocode(location: str) -> Optional[dict]:
    norm = re.sub(r"\s+", " ", location.strip().lower())
    if len(norm) < 2:
        return None
    cached = await db.weather_geocache.find_one({"_id": norm}, {"_id": 0, "value": 1})
    if cached is not None:
        return cached.get("value")  # may be None (negative cache)

    value = None
    for q in _geocode_candidates(location):
        try:
            r = await _http().get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": q, "count": 1, "language": "en", "format": "json"},
            )
            r.raise_for_status()
            results = (r.json() or {}).get("results") or []
            if results:
                it = results[0]
                value = {
                    "name": it.get("name"), "latitude": it["latitude"], "longitude": it["longitude"],
                    "timezone": it.get("timezone", "auto"), "admin1": it.get("admin1"), "country": it.get("country"),
                }
                break
        except Exception:
            continue

    await db.weather_geocache.replace_one(
        {"_id": norm},
        {"_id": norm, "value": value, "expiresAt": datetime.now(timezone.utc) + timedelta(days=7)},
        upsert=True,
    )
    return value


async def _forecast(lat: float, lon: float, tz: str) -> Optional[dict]:
    key = f"{round(lat,4)},{round(lon,4)},{tz}"
    cached = await db.weather_forecastcache.find_one({"_id": key}, {"_id": 0, "value": 1})
    if cached is not None:
        return cached.get("value")
    try:
        r = await _http().get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lon,
                "daily": "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max",
                "temperature_unit": "fahrenheit", "timezone": tz or "auto", "forecast_days": 16,
            },
        )
        if r.status_code == 429:
            return None  # provider daily limit — don't cache, retry later
        r.raise_for_status()
        data = r.json()
    except Exception:
        return None
    if not isinstance(data, dict) or data.get("error"):
        return None
    await db.weather_forecastcache.replace_one(
        {"_id": key},
        {"_id": key, "value": data, "expiresAt": datetime.now(timezone.utc) + timedelta(hours=1)},
        upsert=True,
    )
    return data


@router.get("/weather")
async def get_weather(
    location: str = Query("", max_length=250),
    date: str = Query(..., description="YYYY-MM-DD"),
    current_user=Depends(get_current_user),
):
    def out(available: bool, reason: Optional[str] = None, **extra):
        return {"available": available, "reason": reason, "date": date, **extra}

    loc = (location or "").strip()
    if not loc:
        return out(False, "no_location")

    try:
        target = date_cls.fromisoformat(str(date)[:10])
    except Exception:
        return out(False, "bad_date")

    today = datetime.now(timezone.utc).date()
    days_ahead = (target - today).days
    if days_ahead < 0:
        return out(False, "past")
    if days_ahead > 15:
        return out(False, "out_of_range")

    place = await _geocode(loc)
    if not place:
        return out(False, "not_found")

    data = await _forecast(place["latitude"], place["longitude"], place.get("timezone") or "auto")
    if not data or data.get("error"):
        return out(False, "unavailable")
    daily = data.get("daily") or {}
    times = daily.get("time") or []
    iso = target.isoformat()
    if iso not in times:
        return out(False, "out_of_range")
    i = times.index(iso)

    def at(name):
        arr = daily.get(name) or []
        return arr[i] if i < len(arr) else None

    code = at("weather_code")
    label, emoji = WMO.get(int(code), ("Unknown", "🌡️")) if code is not None else ("Unknown", "🌡️")
    tmax = at("temperature_2m_max")
    tmin = at("temperature_2m_min")
    return out(
        True, None,
        location_name=place.get("name"),
        high_f=round(tmax) if tmax is not None else None,
        low_f=round(tmin) if tmin is not None else None,
        weather_code=code,
        condition=label,
        emoji=emoji,
        precip_pct=at("precipitation_probability_max"),
    )
