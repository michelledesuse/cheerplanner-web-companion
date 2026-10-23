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
import logging
import re
from datetime import datetime, timezone, timedelta, date as date_cls
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, Query

from core.db import db
from core.models import utcnow_iso
from core.security import get_current_user

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

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
    # Soft expiry: stale entries are ignored and overwritten (no TTL deletes).
    # Negative ("not found") entries only count if they came from a real
    # provider answer (v2 flag) — older ones may be cached outages, so refetch.
    cached = await db.weather_geocache.find_one(
        {"_id": norm, "expiresAt": {"$gt": datetime.now(timezone.utc)},
         "$or": [{"value": {"$ne": None}}, {"negative_v2": True}]},
        {"_id": 0, "value": 1})
    if cached is not None:
        return cached.get("value")  # may be None (confirmed not found)

    value = None
    provider_answered = False
    for q in _geocode_candidates(location):
        try:
            r = await _http().get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": q, "count": 1, "language": "en", "format": "json"},
            )
            if r.status_code == 429:
                break  # rate limited — don't treat as "not found"
            r.raise_for_status()
            provider_answered = True
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

    if value is None and not provider_answered:
        return None  # provider unreachable — retry on the next request
    await db.weather_geocache.replace_one(
        {"_id": norm},
        {"_id": norm, "value": value, "negative_v2": value is None,
         "expiresAt": datetime.now(timezone.utc) + (timedelta(days=7) if value else timedelta(days=1))},
        upsert=True,
    )
    return value


def _metno_wmo(symbol: Optional[str]) -> Optional[int]:
    """Map a MET Norway symbol_code (e.g. 'lightrainshowers_day') to a WMO code."""
    if not symbol:
        return None
    s = symbol.split("_")[0]
    if "thunder" in s:
        return 95
    table = {
        "clearsky": 0, "fair": 1, "partlycloudy": 2, "cloudy": 3, "fog": 45,
        "lightrain": 61, "rain": 63, "heavyrain": 65,
        "lightrainshowers": 80, "rainshowers": 81, "heavyrainshowers": 82,
        "lightsleet": 66, "sleet": 66, "heavysleet": 67,
        "lightsleetshowers": 66, "sleetshowers": 66, "heavysleetshowers": 67,
        "lightsnow": 71, "snow": 73, "heavysnow": 75,
        "lightsnowshowers": 85, "snowshowers": 85, "heavysnowshowers": 86,
    }
    return table.get(s)


async def _forecast_metno(lat: float, lon: float, tz: str) -> Optional[dict]:
    """Backup provider (MET Norway, free, no key, ~10 days). Returns data in the
    same daily shape as Open-Meteo so the endpoint code stays identical."""
    try:
        r = await _http().get(
            "https://api.met.no/weatherapi/locationforecast/2.0/complete",
            params={"lat": round(lat, 4), "lon": round(lon, 4)},
            headers={"User-Agent": "CheerPlanner/3.2 https://cheer-planner.com"},
        )
        r.raise_for_status()
        series = ((r.json() or {}).get("properties") or {}).get("timeseries") or []
    except Exception as exc:
        logger.warning(f"MET Norway forecast failed: {exc}")
        return None
    try:
        zone = ZoneInfo(tz) if tz and tz != "auto" else timezone.utc
    except Exception:
        zone = timezone.utc

    days: dict = {}
    for ts in series:
        try:
            t = datetime.fromisoformat(ts["time"].replace("Z", "+00:00")).astimezone(zone)
        except Exception:
            continue
        data = ts.get("data") or {}
        d = days.setdefault(t.date().isoformat(), {"temps": [], "probs": [], "symbol": None, "noon_gap": 99})
        temp = ((data.get("instant") or {}).get("details") or {}).get("air_temperature")
        if temp is not None:
            d["temps"].append(temp * 9 / 5 + 32)
        for block in ("next_1_hours", "next_6_hours", "next_12_hours"):
            b = data.get(block) or {}
            p = (b.get("details") or {}).get("probability_of_precipitation")
            if p is not None:
                d["probs"].append(p)
            sym = (b.get("summary") or {}).get("symbol_code")
            gap = abs(t.hour - 12)
            if sym and gap < d["noon_gap"]:
                d["symbol"], d["noon_gap"] = sym, gap
    times = [k for k in sorted(days) if days[k]["temps"]]
    if not times:
        return None
    return {"daily": {
        "time": times,
        "temperature_2m_max": [max(days[k]["temps"]) for k in times],
        "temperature_2m_min": [min(days[k]["temps"]) for k in times],
        "weather_code": [_metno_wmo(days[k]["symbol"]) for k in times],
        "precipitation_probability_max": [round(max(days[k]["probs"])) if days[k]["probs"] else None for k in times],
    }}


async def _forecast_openmeteo(lat: float, lon: float, tz: str) -> Optional[dict]:
    try:
        r = await _http().get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lon,
                "daily": "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max",
                "temperature_unit": "fahrenheit", "timezone": tz or "auto", "forecast_days": 16,
            },
        )
        if r.status_code != 200:
            logger.warning(f"Open-Meteo forecast HTTP {r.status_code}: {r.text[:200]}")
            return None
        data = r.json()
    except Exception as exc:
        logger.warning(f"Open-Meteo forecast failed: {exc}")
        return None
    if not isinstance(data, dict) or data.get("error"):
        return None
    return data


async def _forecast(lat: float, lon: float, tz: str) -> Optional[dict]:
    key = f"{round(lat,4)},{round(lon,4)},{tz}"
    cached = await db.weather_forecastcache.find_one(
        {"_id": key, "expiresAt": {"$gt": datetime.now(timezone.utc)}}, {"_id": 0, "value": 1})
    if cached is not None:
        return cached.get("value")
    # Open-Meteo first (16 days); its free tier is per-IP and shared hosting
    # can exhaust it, so fall back to MET Norway (~10 days) when it fails.
    data = await _forecast_openmeteo(lat, lon, tz) or await _forecast_metno(lat, lon, tz)
    if not data:
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
