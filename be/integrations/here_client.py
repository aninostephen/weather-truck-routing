"""HERE Geocoding & Search v1 and Routing v8 (Truck Mode) integration."""

from datetime import datetime, timedelta, timezone
import math
from typing import Any

from django.conf import settings
import flexpolyline
import requests

from common.constants import LB_TO_KG, METERS_TO_MILES, TRACTOR_TARE_WEIGHT_LB
from common.exceptions import ConfigurationError, GeocodingError, RoutingError
from services.checkpoint_generator import haversine_miles

DEFAULT_TIMEOUT_SECONDS = 12


def _get_here_api_key() -> str:
    api_key = getattr(settings, "HERE_API_KEY", "").strip()
    if not api_key or api_key == "your_here_api_key_here":
        raise ConfigurationError(
            "HERE_API_KEY is not configured. Set it in be/.env before requesting routes."
        )
    return api_key


def _get_here_url(setting_name: str) -> str:
    url = getattr(settings, setting_name, "").strip()
    if not url:
        raise ConfigurationError(
            f"{setting_name} is not configured. Set it in be/.env."
        )
    return url


def geocode_suggestions(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Return geocoded location candidates for autocomplete / search inputs."""
    cleaned = query.strip()
    if not cleaned:
        return []

    api_key = _get_here_api_key()
    geocode_url = _get_here_url("HERE_GEOCODE_URL")
    try:
        response = requests.get(
            geocode_url,
            params={
                "q": cleaned,
                "limit": max(1, min(limit, 10)),
                "lang": "en-US",
                "apiKey": api_key,
            },
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise GeocodingError(f"Failed to reach HERE Geocoding API: {exc}", status_code=502) from exc

    if response.status_code in (401, 403):
        raise ConfigurationError("Invalid or unauthorized HERE_API_KEY.", status_code=502)
    if not response.ok:
        raise GeocodingError(
            f"HERE Geocoding API returned status {response.status_code}.",
            status_code=502,
        )

    payload = response.json()
    results: list[dict[str, Any]] = []
    for item in payload.get("items", []):
        pos = item.get("position") or {}
        if "lat" not in pos or "lng" not in pos:
            continue
        address = item.get("address") or {}
        results.append(
            {
                "label": address.get("label") or item.get("title") or cleaned,
                "lat": float(pos["lat"]),
                "lng": float(pos["lng"]),
                "city": address.get("city"),
                "state": address.get("stateCode") or address.get("state"),
                "country": address.get("countryCode") or address.get("countryName"),
            }
        )
    return results


def resolve_location(location: str | dict[str, Any], field_name: str = "location") -> dict[str, Any]:
    """Resolve either a `{lat, lng, label}` dict or an address string into `{label, lat, lng}`."""
    if isinstance(location, dict):
        if "lat" in location and "lng" in location:
            lat = float(location["lat"])
            lng = float(location["lng"])
            label = str(location.get("label") or f"{lat:.4f}, {lng:.4f}").strip()
            return {"label": label, "lat": lat, "lng": lng}
        query_text = str(location.get("label") or "").strip()
    else:
        query_text = str(location).strip()

    if not query_text:
        raise GeocodingError(f"Please provide a valid {field_name}.")

    matches = geocode_suggestions(query_text, limit=1)
    if not matches:
        raise GeocodingError(f"Could not find coordinates for {field_name}: '{query_text}'.")
    best = matches[0]
    return {
        "label": best["label"],
        "lat": best["lat"],
        "lng": best["lng"],
    }


def _format_here_departure(departure_time: datetime) -> str | None:
    """
    Format departure time for HERE Routing v8.
    HERE rejects timestamps significantly in the past, so past timestamps omit
    `departureTime` (using current traffic speeds) while checkpoint ETAs still honor user input.
    """
    utc_dt = departure_time.astimezone(timezone.utc)
    if utc_dt < datetime.now(timezone.utc) - timedelta(minutes=5):
        return None
    return utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_here_route(raw_route: dict[str, Any], index: int) -> dict[str, Any] | None:
    """Decode sections of a HERE v8 route into coordinates, distance, duration, and highway labels."""
    sections = raw_route.get("sections") or []
    if not sections:
        return None

    coordinates: list[tuple[float, float]] = []
    total_duration_s = 0.0
    total_length_m = 0.0
    road_names: list[str] = []

    for section in sections:
        encoded = section.get("polyline")
        if not encoded:
            continue
        decoded = flexpolyline.decode(encoded)
        section_coords = [(float(pt[0]), float(pt[1])) for pt in decoded]
        if not section_coords:
            continue

        if coordinates and coordinates[-1] == section_coords[0]:
            coordinates.extend(section_coords[1:])
        else:
            coordinates.extend(section_coords)

        summary = section.get("summary") or {}
        total_duration_s += float(summary.get("duration", 0.0))
        total_length_m += float(summary.get("length", 0.0))

        for label_obj in section.get("routeLabels") or []:
            attributes = label_obj.get("attributes") or {}
            names = attributes.get("names") or label_obj.get("names") or []
            for name_entry in names:
                val = (name_entry.get("value") if isinstance(name_entry, dict) else str(name_entry)).strip()
                if val and val not in road_names:
                    road_names.append(val)

    if len(coordinates) < 2:
        return None

    distance_miles = total_length_m * METERS_TO_MILES
    via_suffix = f" via {', '.join(road_names[:2])}" if road_names else ""

    return {
        "id": f"route-{index}",
        "name": f"Route {index}{via_suffix}",
        "road_labels": road_names[:4],
        "coordinates": coordinates,
        "distance_miles": round(distance_miles, 2),
        "duration_seconds": round(total_duration_s, 1),
    }


def _is_duplicate_route(candidate: dict[str, Any], existing_routes: list[dict[str, Any]]) -> bool:
    """Check whether `candidate` has nearly identical distance and midpoint as an existing route."""
    cand_coords = candidate["coordinates"]
    cand_mid = cand_coords[len(cand_coords) // 2]
    cand_dist = candidate["distance_miles"]

    for route in existing_routes:
        other_coords = route["coordinates"]
        other_mid = other_coords[len(other_coords) // 2]
        other_dist = route["distance_miles"]

        rel_diff = abs(cand_dist - other_dist) / max(other_dist, 1.0)
        mid_gap_miles = haversine_miles(cand_mid[0], cand_mid[1], other_mid[0], other_mid[1])
        if rel_diff < 0.015 and mid_gap_miles < 3.0:
            return True
    return False


def _compute_lateral_waypoint(
    origin: dict[str, Any],
    destination: dict[str, Any],
    direction_sign: float,
) -> tuple[float, float]:
    """Compute a perpendicular midpoint waypoint to synthesize an alternative corridor."""
    lat1, lng1 = origin["lat"], origin["lng"]
    lat2, lng2 = destination["lat"], destination["lng"]
    mid_lat = (lat1 + lat2) / 2.0
    mid_lng = (lng1 + lng2) / 2.0

    direct_miles = haversine_miles(lat1, lng1, lat2, lng2)
    offset_miles = max(8.0, min(120.0, direct_miles * 0.14)) * direction_sign

    cos_lat = max(math.cos(math.radians(mid_lat)), 0.1)
    dy = (lat2 - lat1) * 69.0
    dx = (lng2 - lng1) * 69.0 * cos_lat
    norm = math.hypot(dx, dy)
    if norm < 1e-6:
        return (mid_lat, mid_lng)

    perp_x = -dy / norm
    perp_y = dx / norm
    via_lat = max(-85.0, min(85.0, mid_lat + (perp_y * offset_miles) / 69.0))
    via_lng = mid_lng + (perp_x * offset_miles) / (69.0 * cos_lat)
    return (round(via_lat, 5), round(via_lng, 5))


def _request_here_routes(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Execute a single HERE Routing v8 call and return raw route objects."""
    routes_url = _get_here_url("HERE_ROUTES_URL")
    try:
        response = requests.get(
            routes_url,
            params=params,
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise RoutingError(f"Failed to reach HERE Routing API: {exc}", status_code=502) from exc

    if response.status_code in (401, 403):
        raise ConfigurationError("Invalid or unauthorized HERE_API_KEY.", status_code=502)
    if not response.ok:
        detail = ""
        try:
            err_json = response.json()
            detail = err_json.get("title") or err_json.get("cause") or ""
        except ValueError:
            detail = ""
        suffix = f" ({detail})" if detail else ""
        raise RoutingError(
            f"HERE Routing API returned status {response.status_code}{suffix}.",
            status_code=502,
        )

    return response.json().get("routes") or []


def fetch_truck_routes(
    origin: dict[str, Any],
    destination: dict[str, Any],
    departure_time: datetime,
    load_weight_lb: float,
    target_count: int = 3,
) -> list[dict[str, Any]]:
    """
    Fetch up to `target_count` (3) distinct truck routes from HERE Routing v8.
    Automatically applies fallback avoidance / lateral waypoints when the primary
    corridor returns fewer than 3 natural alternatives.
    """
    api_key = _get_here_api_key()
    gross_weight_kg = max(
        1000,
        round((TRACTOR_TARE_WEIGHT_LB + max(0.0, float(load_weight_lb))) * LB_TO_KG),
    )

    base_params: dict[str, Any] = {
        "transportMode": "truck",
        "origin": f"{origin['lat']},{origin['lng']}",
        "destination": f"{destination['lat']},{destination['lng']}",
        "alternatives": max(0, target_count - 1),
        "vehicle[grossWeight]": gross_weight_kg,
        "return": "polyline,summary,routeLabels",
        "apiKey": api_key,
    }
    departure_str = _format_here_departure(departure_time)
    if departure_str:
        base_params["departureTime"] = departure_str

    raw_routes = _request_here_routes(base_params)
    collected: list[dict[str, Any]] = []

    def _ingest(raw_list: list[dict[str, Any]]) -> None:
        for raw in raw_list:
            if len(collected) >= target_count:
                return
            parsed = _parse_here_route(raw, len(collected) + 1)
            if parsed and not _is_duplicate_route(parsed, collected):
                collected.append(parsed)

    _ingest(raw_routes)

    # Fallback 1: toll-free and shortest-distance truck alternatives if < 3 routes returned
    if 0 < len(collected) < target_count:
        for extra_params in (
            {"alternatives": 1, "avoid[features]": "tollRoad"},
            {"alternatives": 1, "routingMode": "short"},
        ):
            if len(collected) >= target_count:
                break
            try:
                _ingest(_request_here_routes({**base_params, **extra_params}))
            except RoutingError:
                continue

    # Fallback 2: lateral corridor waypoints (+offset and -offset) if still < 3 routes
    if 0 < len(collected) < target_count:
        for sign in (1.0, -1.0):
            if len(collected) >= target_count:
                break
            via_lat, via_lng = _compute_lateral_waypoint(origin, destination, sign)
            via_params = {
                **base_params,
                "alternatives": 0,
                "via": f"{via_lat},{via_lng}!passThrough=true",
            }
            try:
                _ingest(_request_here_routes(via_params))
            except RoutingError:
                continue

    if not collected:
        raise RoutingError(
            "No drivable truck routes were found between the selected origin and destination.",
            status_code=400,
        )

    # Ensure sequential route numbering and names
    for idx, route in enumerate(collected, start=1):
        route["id"] = f"route-{idx}"
        labels = route.get("road_labels") or []
        via_suffix = f" via {', '.join(labels[:2])}" if labels else ""
        route["name"] = f"Route {idx}{via_suffix}"

    return collected

