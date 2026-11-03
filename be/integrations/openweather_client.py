"""OpenWeather API integration with spatial-grid caching, dual-tier support, and interpolation."""

from bisect import bisect_left
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from django.conf import settings
from django.core.cache import cache
import requests

from common.constants import (
    MM_TO_INCHES,
    SNOW_TO_LIQUID_RATIO,
    WEATHER_CACHE_TTL_SECONDS,
)
from common.exceptions import ConfigurationError, WeatherServiceError
from services.checkpoint_generator import Coordinate, haversine_miles

DEFAULT_TIMEOUT_SECONDS = 10
MAX_CONCURRENT_REQUESTS = 8


def _get_openweather_api_key() -> str:
    api_key = getattr(settings, "OPENWEATHER_API_KEY", "").strip()
    if not api_key or api_key == "your_openweather_api_key_here":
        raise ConfigurationError(
            "OPENWEATHER_API_KEY is not configured. Set it in be/.env before requesting routes."
        )
    return api_key


def _get_openweather_url(setting_name: str) -> str:
    url = getattr(settings, setting_name, "").strip()
    if not url:
        raise ConfigurationError(
            f"{setting_name} is not configured. Set it in be/.env."
        )
    return url


def _parse_forecast25_payload(payload: dict[str, Any]) -> list[dict[str, float]]:
    """
    Convert OpenWeather /data/2.5/forecast (3-hour intervals) into sorted hourly-rate points.
    Note: With `units=imperial`, wind is in mph, while rain.3h and snow.3h remain in mm
    of liquid water over 3 hours.
    """
    timeline: list[dict[str, float]] = []
    for item in payload.get("list") or []:
        ts = float(item["dt"])
        wind_mph = float((item.get("wind") or {}).get("speed", 0.0))
        rain_mm_3h = float((item.get("rain") or {}).get("3h", 0.0))
        snow_mm_3h = float((item.get("snow") or {}).get("3h", 0.0))

        rain_in_hr = (rain_mm_3h / 3.0) * MM_TO_INCHES
        snow_in_hr = (snow_mm_3h / 3.0) * SNOW_TO_LIQUID_RATIO * MM_TO_INCHES

        timeline.append(
            {
                "ts": ts,
                "wind_mph": max(0.0, wind_mph),
                "rain_in_hr": max(0.0, rain_in_hr),
                "snow_in_hr": max(0.0, snow_in_hr),
            }
        )

    timeline.sort(key=lambda entry: entry["ts"])
    return timeline


def _parse_onecall30_payload(payload: dict[str, Any]) -> list[dict[str, float]]:
    """
    Convert OpenWeather /data/3.0/onecall (1-hour intervals for 48h) into sorted points.
    """
    entries: list[dict[str, Any]] = []
    if payload.get("current"):
        entries.append(payload["current"])
    entries.extend(payload.get("hourly") or [])

    by_ts: dict[float, dict[str, float]] = {}
    for item in entries:
        if "dt" not in item:
            continue
        ts = float(item["dt"])
        wind_mph = float(item.get("wind_speed", 0.0))
        rain_mm_1h = float((item.get("rain") or {}).get("1h", 0.0))
        snow_mm_1h = float((item.get("snow") or {}).get("1h", 0.0))

        by_ts[ts] = {
            "ts": ts,
            "wind_mph": max(0.0, wind_mph),
            "rain_in_hr": max(0.0, rain_mm_1h * MM_TO_INCHES),
            "snow_in_hr": max(0.0, snow_mm_1h * SNOW_TO_LIQUID_RATIO * MM_TO_INCHES),
        }

    return [by_ts[k] for k in sorted(by_ts)]


def _fetch_forecast25(lat: float, lng: float, api_key: str) -> list[dict[str, float]]:
    forecast_url = _get_openweather_url("OPENWEATHER_FORECAST_25_URL")
    try:
        resp = requests.get(
            forecast_url,
            params={
                "lat": lat,
                "lon": lng,
                "units": "imperial",
                "appid": api_key,
            },
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise WeatherServiceError(f"Failed to reach OpenWeather API: {exc}", status_code=502) from exc

    if resp.status_code in (401, 403):
        raise ConfigurationError(
            "Invalid or inactive OPENWEATHER_API_KEY (note: newly created keys can take ~15-60 min to activate).",
            status_code=502,
        )
    if resp.status_code == 429:
        raise WeatherServiceError(
            "OpenWeather API rate limit exceeded. Please retry shortly.",
            status_code=429,
        )
    if not resp.ok:
        raise WeatherServiceError(
            f"OpenWeather 2.5 Forecast API returned status {resp.status_code}.",
            status_code=502,
        )

    timeline = _parse_forecast25_payload(resp.json())
    if not timeline:
        raise WeatherServiceError("OpenWeather returned an empty forecast timeline.")
    return timeline


def _fetch_station_timeline(lat: float, lng: float, api_key: str, mode: str) -> list[dict[str, float]]:
    """Fetch (or read from cache) the forecast timeline for a rounded grid station."""
    rounded_lat = round(lat, 2)
    rounded_lng = round(lng, 2)
    cache_key = f"owm:v1:{mode}:{rounded_lat:.2f}:{rounded_lng:.2f}"

    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    timeline: list[dict[str, float]]
    if mode == "onecall30":
        onecall_url = _get_openweather_url("OPENWEATHER_ONECALL_30_URL")
        try:
            resp = requests.get(
                onecall_url,
                params={
                    "lat": rounded_lat,
                    "lon": rounded_lng,
                    "exclude": "minutely,daily,alerts",
                    "units": "imperial",
                    "appid": api_key,
                },
                timeout=DEFAULT_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise WeatherServiceError(f"Failed to reach OpenWeather One Call API: {exc}", status_code=502) from exc

        if resp.status_code in (401, 403):
            # Automatic fallback to Free 2.5 Forecast when key has no One Call 3.0 subscription
            timeline = _fetch_forecast25(rounded_lat, rounded_lng, api_key)
        elif resp.status_code == 429:
            raise WeatherServiceError("OpenWeather API rate limit exceeded.", status_code=429)
        elif not resp.ok:
            raise WeatherServiceError(
                f"OpenWeather One Call 3.0 API returned status {resp.status_code}.",
                status_code=502,
            )
        else:
            timeline = _parse_onecall30_payload(resp.json())
            if not timeline:
                timeline = _fetch_forecast25(rounded_lat, rounded_lng, api_key)
    else:
        timeline = _fetch_forecast25(rounded_lat, rounded_lng, api_key)

    cache.set(cache_key, timeline, timeout=WEATHER_CACHE_TTL_SECONDS)
    return timeline


def fetch_corridor_weather_stations(
    station_coords: list[Coordinate],
) -> list[dict[str, Any]]:
    """
    Concurrently fetch and cache forecast timelines for all unique corridor grid points.
    Returns `[{"lat": float, "lng": float, "timeline": [...]}, ...]`.
    """
    if not station_coords:
        return []

    api_key = _get_openweather_api_key()
    mode = getattr(settings, "OPENWEATHER_MODE", "forecast25").strip().lower()

    deduped: list[Coordinate] = []
    seen: set[tuple[float, float]] = set()
    for lat, lng in station_coords:
        key = (round(lat, 2), round(lng, 2))
        if key not in seen:
            seen.add(key)
            deduped.append(key)

    stations: list[dict[str, Any]] = []
    workers = min(MAX_CONCURRENT_REQUESTS, len(deduped))

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_coord = {
            executor.submit(_fetch_station_timeline, lat, lng, api_key, mode): (lat, lng)
            for lat, lng in deduped
        }
        for future in as_completed(future_to_coord):
            lat, lng = future_to_coord[future]
            timeline = future.result()
            stations.append(
                {
                    "lat": lat,
                    "lng": lng,
                    "timestamps": [pt["ts"] for pt in timeline],
                    "timeline": timeline,
                }
            )

    return stations


def interpolate_station_at_timestamp(
    station: dict[str, Any],
    target_ts: float,
) -> dict[str, float]:
    """Linearly interpolate a single station's weather values at `target_ts`."""
    timeline: list[dict[str, float]] = station["timeline"]
    timestamps: list[float] = station["timestamps"]

    if target_ts <= timestamps[0]:
        first = timeline[0]
        return {
            "wind_mph": first["wind_mph"],
            "rain_in_hr": first["rain_in_hr"],
            "snow_in_hr": first["snow_in_hr"],
        }

    if target_ts >= timestamps[-1]:
        last = timeline[-1]
        return {
            "wind_mph": last["wind_mph"],
            "rain_in_hr": last["rain_in_hr"],
            "snow_in_hr": last["snow_in_hr"],
        }

    idx = bisect_left(timestamps, target_ts)
    if timestamps[idx] == target_ts:
        exact = timeline[idx]
        return {
            "wind_mph": exact["wind_mph"],
            "rain_in_hr": exact["rain_in_hr"],
            "snow_in_hr": exact["snow_in_hr"],
        }

    prev_pt = timeline[idx - 1]
    next_pt = timeline[idx]
    span = next_pt["ts"] - prev_pt["ts"]
    alpha = 0.0 if span <= 0 else (target_ts - prev_pt["ts"]) / span

    return {
        "wind_mph": prev_pt["wind_mph"] + (next_pt["wind_mph"] - prev_pt["wind_mph"]) * alpha,
        "rain_in_hr": prev_pt["rain_in_hr"] + (next_pt["rain_in_hr"] - prev_pt["rain_in_hr"]) * alpha,
        "snow_in_hr": prev_pt["snow_in_hr"] + (next_pt["snow_in_hr"] - prev_pt["snow_in_hr"]) * alpha,
    }


def interpolate_weather_at_point(
    stations: list[dict[str, Any]],
    lat: float,
    lng: float,
    target_ts: float,
    nearest_k: int = 3,
) -> dict[str, float]:
    """
    Inverse-distance-weighted (IDW) spatial + temporal interpolation from the `nearest_k`
    corridor weather stations at `(lat, lng)` and epoch timestamp `target_ts`.
    """
    if not stations:
        return {"wind_mph": 0.0, "rain_in_hr": 0.0, "snow_in_hr": 0.0}

    ranked_distances: list[tuple[float, dict[str, Any]]] = []
    for st in stations:
        dist = haversine_miles(lat, lng, st["lat"], st["lng"])
        if dist < 0.25:
            val = interpolate_station_at_timestamp(st, target_ts)
            return {
                "wind_mph": round(val["wind_mph"], 2),
                "rain_in_hr": round(val["rain_in_hr"], 3),
                "snow_in_hr": round(val["snow_in_hr"], 3),
            }
        ranked_distances.append((dist, st))

    ranked_distances.sort(key=lambda pair: pair[0])
    chosen = ranked_distances[: max(1, nearest_k)]

    weight_sum = 0.0
    wind_acc = 0.0
    rain_acc = 0.0
    snow_acc = 0.0

    for dist, st in chosen:
        weight = 1.0 / (dist * dist)
        sample = interpolate_station_at_timestamp(st, target_ts)
        weight_sum += weight
        wind_acc += sample["wind_mph"] * weight
        rain_acc += sample["rain_in_hr"] * weight
        snow_acc += sample["snow_in_hr"] * weight

    return {
        "wind_mph": round(wind_acc / weight_sum, 2),
        "rain_in_hr": round(rain_acc / weight_sum, 3),
        "snow_in_hr": round(snow_acc / weight_sum, 3),
    }

