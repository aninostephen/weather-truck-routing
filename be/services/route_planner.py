"""End-to-end orchestration for weather-aware truck route planning and 0-48h corridor heatmap."""

from datetime import datetime, timedelta, timezone
from typing import Any

from common.constants import (
    DEFAULT_SAMPLING_INTERVAL_MILES,
    FORECAST_SLIDER_HOURS,
    RAIN_MODERATE_MIN_IN_HR,
    SNOW_MODERATE_MIN_IN_HR,
    WIND_MODERATE_MIN_MPH,
)
from common.exceptions import GeocodingError
from integrations.here_client import fetch_truck_routes, resolve_location
from integrations.openweather_client import (
    fetch_corridor_weather_stations,
    interpolate_station_at_timestamp,
    interpolate_weather_at_point,
)
from services.checkpoint_generator import (
    Coordinate,
    build_corridor_heatmap_grid,
    build_weather_station_grid,
    haversine_miles,
    sample_route_checkpoints,
)
from services.recommendation import select_recommended_route, summarize_route_risk
from services.risk_calculator import evaluate_checkpoint_risk


def _compute_continuous_intensity(
    wind_mph: float,
    rain_in_hr: float,
    snow_in_hr: float,
    risk_score: int,
) -> float:
    """
    Map discrete risk score (0..4) + raw weather values onto a smooth [0.0, 1.0]
    weight monotonic with the PDF risk tiers for WebGL heatmap rendering.
    """
    if risk_score >= 4:
        return 1.0
    if risk_score == 3:
        sub = min(1.0, max(wind_mph / 55.0, rain_in_hr / 1.0, snow_in_hr / 3.0))
        return round(0.75 + 0.20 * sub, 3)
    if risk_score == 2:
        sub = min(1.0, max(wind_mph / 45.0, rain_in_hr / 0.50, snow_in_hr / 2.0))
        return round(0.50 + 0.24 * sub, 3)
    if risk_score == 1:
        sub = min(1.0, max(wind_mph / 35.0, rain_in_hr / 0.25, snow_in_hr / 1.0))
        return round(0.25 + 0.24 * sub, 3)

    low_fraction = min(
        1.0,
        max(
            wind_mph / WIND_MODERATE_MIN_MPH,
            rain_in_hr / RAIN_MODERATE_MIN_IN_HR,
            snow_in_hr / SNOW_MODERATE_MIN_IN_HR,
        ),
    )
    return round(0.24 * low_fraction, 3)


def _precompute_idw_links(
    points: list[Coordinate],
    stations: list[dict[str, Any]],
    nearest_k: int = 3,
) -> list[list[tuple[int, float]]]:
    """Precompute normalized IDW station weights for each corridor heatmap point."""
    links: list[list[tuple[int, float]]] = []
    if not stations:
        return [[] for _ in points]

    for lat, lng in points:
        dists: list[tuple[float, int]] = []
        exact_idx: int | None = None
        for idx, st in enumerate(stations):
            d = haversine_miles(lat, lng, st["lat"], st["lng"])
            if d < 0.25:
                exact_idx = idx
                break
            dists.append((d, idx))

        if exact_idx is not None:
            links.append([(exact_idx, 1.0)])
            continue

        dists.sort(key=lambda item: item[0])
        chosen = dists[: max(1, nearest_k)]
        raw_weights = [(idx, 1.0 / (d * d)) for d, idx in chosen]
        total_w = sum(w for _, w in raw_weights)
        links.append([(idx, w / total_w) for idx, w in raw_weights])

    return links


def _build_corridor_heatmap(
    routes_coordinates: list[list[Coordinate]],
    stations: list[dict[str, Any]],
    departure_time: datetime,
    load_weight_lb: float,
) -> dict[str, Any]:
    """
    Build a compact, precomputed 0-48h hourly forecast matrix over the trip corridor
    so the frontend slider scrubs at 60 FPS without network round-trips.
    """
    corridor_points, grid_spacing_miles = build_corridor_heatmap_grid(routes_coordinates)
    idw_links = _precompute_idw_links(corridor_points, stations)

    # Anchor slider at departure_time (or now if departure_time is in the past)
    now_utc = datetime.now(timezone.utc)
    anchor_dt = max(departure_time.astimezone(timezone.utc), now_utc)

    hours_payload: list[dict[str, Any]] = []
    for hour_offset in range(FORECAST_SLIDER_HOURS + 1):
        frame_dt = anchor_dt + timedelta(hours=hour_offset)
        frame_ts = frame_dt.timestamp()

        station_snapshots = [
            interpolate_station_at_timestamp(st, frame_ts)
            for st in stations
        ]

        # Compact per-point tuple: [intensity, risk_score, wind_mph, rain_in_hr, snow_in_hr]
        values: list[list[float]] = []
        for point_links in idw_links:
            wind = 0.0
            rain = 0.0
            snow = 0.0
            for st_idx, weight in point_links:
                snap = station_snapshots[st_idx]
                wind += snap["wind_mph"] * weight
                rain += snap["rain_in_hr"] * weight
                snow += snap["snow_in_hr"] * weight

            wind_r = round(wind, 1)
            rain_r = round(rain, 3)
            snow_r = round(snow, 3)
            risk_eval = evaluate_checkpoint_risk(wind_r, rain_r, snow_r, load_weight_lb)
            score = int(risk_eval["risk_score"])
            intensity = _compute_continuous_intensity(wind_r, rain_r, snow_r, score)
            values.append([intensity, score, wind_r, rain_r, snow_r])

        hours_payload.append(
            {
                "hour_offset": hour_offset,
                "timestamp": frame_dt.isoformat(),
                "values": values,
            }
        )

    return {
        "anchor_time": anchor_dt.isoformat(),
        "max_hours": FORECAST_SLIDER_HOURS,
        "grid_spacing_miles": grid_spacing_miles,
        "value_fields": ["intensity", "risk_score", "wind_mph", "rain_in_hr", "snow_in_hr"],
        "points": [
            {"lat": lat, "lng": lng}
            for lat, lng in corridor_points
        ],
        "hours": hours_payload,
    }


def plan_weather_aware_routes(
    origin_input: str | dict[str, Any],
    destination_input: str | dict[str, Any],
    departure_time: datetime | None = None,
    load_weight_lb: float = 0.0,
    interval_miles: int = DEFAULT_SAMPLING_INTERVAL_MILES,
) -> dict[str, Any]:
    """
    Full pipeline:
      1. Geocode/resolve origin & destination
      2. Fetch 3 truck routes from HERE Routing v8
      3. Build bounded corridor weather station grid & fetch OpenWeather timelines
      4. Sample checkpoints every 10/25/50 mi with exact ETAs, weather & load risk
      5. Rank routes by tie-breaker rules & precompute 0-48h corridor heatmap
    """
    effective_departure = (
        departure_time.astimezone(timezone.utc)
        if departure_time is not None
        else datetime.now(timezone.utc)
    )

    origin = resolve_location(origin_input, field_name="origin")
    destination = resolve_location(destination_input, field_name="destination")

    if haversine_miles(origin["lat"], origin["lng"], destination["lat"], destination["lng"]) < 0.1:
        raise GeocodingError("Origin and destination must be at least 0.1 miles apart.")

    raw_routes = fetch_truck_routes(
        origin=origin,
        destination=destination,
        departure_time=effective_departure,
        load_weight_lb=load_weight_lb,
        target_count=3,
    )

    routes_coords: list[list[Coordinate]] = [r["coordinates"] for r in raw_routes]
    station_coords = build_weather_station_grid(routes_coords)
    weather_stations = fetch_corridor_weather_stations(station_coords)

    analyzed_routes: list[dict[str, Any]] = []
    for route in raw_routes:
        coords = route["coordinates"]
        duration_s = float(route["duration_seconds"])
        distance_mi = float(route["distance_miles"])

        checkpoints = sample_route_checkpoints(
            coordinates=coords,
            total_duration_seconds=duration_s,
            departure_time=effective_departure,
            interval_miles=interval_miles,
        )

        enriched_checkpoints: list[dict[str, Any]] = []
        for cp in checkpoints:
            weather = interpolate_weather_at_point(
                stations=weather_stations,
                lat=cp["lat"],
                lng=cp["lng"],
                target_ts=cp["eta_timestamp"],
            )
            risk_info = evaluate_checkpoint_risk(
                wind_mph=weather["wind_mph"],
                rain_in_hr=weather["rain_in_hr"],
                snow_in_hr=weather["snow_in_hr"],
                load_weight_lb=load_weight_lb,
            )
            enriched_checkpoints.append(
                {
                    "index": cp["index"],
                    "lat": cp["lat"],
                    "lng": cp["lng"],
                    "distance_miles": cp["distance_miles"],
                    "segment_miles": round(cp["segment_miles"], 2),
                    "eta": cp["eta"],
                    "weather": weather,
                    **risk_info,
                }
            )

        risk_summary = summarize_route_risk(enriched_checkpoints, distance_mi)
        arrival_dt = effective_departure + timedelta(seconds=duration_s)

        analyzed_routes.append(
            {
                "id": route["id"],
                "name": route["name"],
                "road_labels": route["road_labels"],
                "distance_miles": distance_mi,
                "duration_seconds": duration_s,
                "duration_minutes": round(duration_s / 60.0, 1),
                "eta": arrival_dt.isoformat(),
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(lng, 6), round(lat, 6)] for lat, lng in coords],
                },
                "risk_summary": risk_summary,
                "checkpoints": enriched_checkpoints,
            }
        )

    recommended_id, reason, has_advisory = select_recommended_route(analyzed_routes)
    analyzed_routes.sort(key=lambda item: item["rank"])

    corridor_heatmap = _build_corridor_heatmap(
        routes_coordinates=routes_coords,
        stations=weather_stations,
        departure_time=effective_departure,
        load_weight_lb=load_weight_lb,
    )

    return {
        "origin": origin,
        "destination": destination,
        "departure_time": effective_departure.isoformat(),
        "load_weight_lb": round(float(load_weight_lb), 1),
        "interval_miles": interval_miles,
        "recommended_route_id": recommended_id,
        "recommendation_reason": reason,
        "has_no_travel_advisory": has_advisory,
        "weather_stations_queried": len(weather_stations),
        "routes": analyzed_routes,
        "corridor_heatmap": corridor_heatmap,
    }

