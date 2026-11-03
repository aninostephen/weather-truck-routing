"""Polyline geometry, checkpoint ETA sampling, and trip corridor grid generation."""

from datetime import datetime, timedelta
import math
from typing import Any

from common.constants import EARTH_RADIUS_MILES, MAX_WEATHER_GRID_POINTS

Coordinate = tuple[float, float]  # (lat, lng)


def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return great-circle distance in miles between two (lat, lng) points."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_MILES * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def compute_cumulative_miles(coordinates: list[Coordinate]) -> list[float]:
    """Compute cumulative distance (miles) at each vertex along a polyline."""
    if not coordinates:
        return []
    cumulative = [0.0]
    for idx in range(1, len(coordinates)):
        lat1, lng1 = coordinates[idx - 1]
        lat2, lng2 = coordinates[idx]
        step = haversine_miles(lat1, lng1, lat2, lng2)
        cumulative.append(cumulative[-1] + step)
    return cumulative


def sample_route_checkpoints(
    coordinates: list[Coordinate],
    total_duration_seconds: float,
    departure_time: datetime,
    interval_miles: int,
) -> list[dict[str, Any]]:
    """
    Sample checkpoints along a route polyline every `interval_miles` (10 / 25 / 50),
    including origin (0 mi) and destination (total miles), with interpolated ETAs
    and Voronoi midpoint segment mile weights summing to total route distance.
    """
    if not coordinates:
        return []

    if len(coordinates) == 1:
        lat, lng = coordinates[0]
        return [
            {
                "index": 0,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "distance_miles": 0.0,
                "segment_miles": 0.0,
                "eta": departure_time.isoformat(),
                "eta_timestamp": departure_time.timestamp(),
            }
        ]

    cumulative = compute_cumulative_miles(coordinates)
    total_miles = cumulative[-1]
    step = float(interval_miles)

    if total_miles <= 1e-6:
        lat, lng = coordinates[0]
        return [
            {
                "index": 0,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "distance_miles": 0.0,
                "segment_miles": 0.0,
                "eta": departure_time.isoformat(),
                "eta_timestamp": departure_time.timestamp(),
            }
        ]

    target_distances = [0.0]
    next_dist = step
    while next_dist < total_miles:
        target_distances.append(next_dist)
        next_dist += step

    # Avoid emitting a near-duplicate point right next to destination
    if total_miles - target_distances[-1] > 0.05:
        target_distances.append(total_miles)
    else:
        target_distances[-1] = total_miles

    sampled_coords: list[Coordinate] = []
    seg_idx = 0
    num_segments = len(coordinates) - 1

    for target in target_distances:
        while seg_idx < num_segments - 1 and cumulative[seg_idx + 1] < target:
            seg_idx += 1

        seg_start = cumulative[seg_idx]
        seg_end = cumulative[seg_idx + 1]
        seg_len = seg_end - seg_start

        lat1, lng1 = coordinates[seg_idx]
        lat2, lng2 = coordinates[seg_idx + 1]

        if seg_len <= 1e-9:
            ratio = 0.0
        else:
            ratio = max(0.0, min(1.0, (target - seg_start) / seg_len))

        lat = lat1 + (lat2 - lat1) * ratio
        lng = lng1 + (lng2 - lng1) * ratio
        sampled_coords.append((lat, lng))

    count = len(target_distances)
    checkpoints: list[dict[str, Any]] = []

    for idx, dist in enumerate(target_distances):
        if count == 1:
            seg_miles = total_miles
        elif idx == 0:
            seg_miles = (target_distances[0] + target_distances[1]) / 2.0
        elif idx == count - 1:
            seg_miles = total_miles - (target_distances[idx - 1] + target_distances[idx]) / 2.0
        else:
            seg_miles = (target_distances[idx + 1] - target_distances[idx - 1]) / 2.0

        progress = dist / total_miles if total_miles > 0 else 0.0
        elapsed_seconds = max(0.0, float(total_duration_seconds)) * progress
        eta_dt = departure_time + timedelta(seconds=elapsed_seconds)
        lat, lng = sampled_coords[idx]

        checkpoints.append(
            {
                "index": idx,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "distance_miles": round(dist, 2),
                "segment_miles": round(seg_miles, 4),
                "eta": eta_dt.isoformat(),
                "eta_timestamp": eta_dt.timestamp(),
            }
        )

    return checkpoints


def _perpendicular_offset(
    lat1: float,
    lng1: float,
    lat2: float,
    lng2: float,
    base_lat: float,
    base_lng: float,
    offset_miles: float,
) -> Coordinate:
    """Return a coordinate offset perpendicularly from segment (1->2) by `offset_miles`."""
    if abs(offset_miles) < 1e-6:
        return (base_lat, base_lng)

    cos_lat = max(math.cos(math.radians(base_lat)), 0.1)
    dy = (lat2 - lat1) * 69.0
    dx = (lng2 - lng1) * 69.0 * cos_lat
    norm = math.hypot(dx, dy)
    if norm < 1e-6:
        return (base_lat, base_lng)

    perp_x = -dy / norm
    perp_y = dx / norm

    new_lat = max(-85.0, min(85.0, base_lat + (perp_y * offset_miles) / 69.0))
    new_lng = base_lng + (perp_x * offset_miles) / (69.0 * cos_lat)
    if new_lng > 180.0:
        new_lng -= 360.0
    elif new_lng < -180.0:
        new_lng += 360.0
    return (new_lat, new_lng)


def _sample_corridor_candidates(
    routes_coordinates: list[list[Coordinate]],
    along_samples_per_route: int,
    lateral_offsets_fraction: tuple[float, ...],
) -> list[Coordinate]:
    """Sample points along each route plus perpendicular corridor offsets."""
    candidates: list[Coordinate] = []

    for coords in routes_coordinates:
        if not coords:
            continue
        if len(coords) == 1:
            candidates.append(coords[0])
            continue

        cum = compute_cumulative_miles(coords)
        total = cum[-1]
        corridor_half_width = max(5.0, min(32.0, total * 0.08))

        sample_count = max(2, along_samples_per_route)
        targets = [
            total * (i / (sample_count - 1))
            for i in range(sample_count)
        ]

        seg_idx = 0
        num_segments = len(coords) - 1

        for target in targets:
            while seg_idx < num_segments - 1 and cum[seg_idx + 1] < target:
                seg_idx += 1

            lat1, lng1 = coords[seg_idx]
            lat2, lng2 = coords[seg_idx + 1]
            seg_len = cum[seg_idx + 1] - cum[seg_idx]
            ratio = 0.0 if seg_len <= 1e-9 else max(0.0, min(1.0, (target - cum[seg_idx]) / seg_len))
            base_lat = lat1 + (lat2 - lat1) * ratio
            base_lng = lng1 + (lng2 - lng1) * ratio

            for frac in lateral_offsets_fraction:
                candidates.append(
                    _perpendicular_offset(
                        lat1,
                        lng1,
                        lat2,
                        lng2,
                        base_lat,
                        base_lng,
                        corridor_half_width * frac,
                    )
                )

    return candidates


def build_weather_station_grid(
    routes_coordinates: list[list[Coordinate]],
    max_stations: int = MAX_WEATHER_GRID_POINTS,
) -> list[Coordinate]:
    """
    Build a bounded, deduplicated spatial grid of weather query points covering
    the trip corridor so OpenWeather stays well within rate limits.
    """
    raw_candidates = _sample_corridor_candidates(
        routes_coordinates,
        along_samples_per_route=14,
        lateral_offsets_fraction=(-1.0, 0.0, 1.0),
    )
    if not raw_candidates:
        return []

    # Adaptively coarsen grid resolution until station count <= max_stations
    grid_step_deg = 0.25
    while grid_step_deg <= 8.0:
        buckets: dict[tuple[int, int], Coordinate] = {}
        for lat, lng in raw_candidates:
            key = (round(lat / grid_step_deg), round(lng / grid_step_deg))
            if key not in buckets:
                snapped_lat = round(key[0] * grid_step_deg, 4)
                snapped_lng = round(key[1] * grid_step_deg, 4)
                buckets[key] = (snapped_lat, snapped_lng)

        if len(buckets) <= max_stations:
            return list(buckets.values())
        grid_step_deg *= 1.35

    return list(buckets.values())[:max_stations]


def build_corridor_heatmap_grid(
    routes_coordinates: list[list[Coordinate]],
    target_points: int = 230,
) -> tuple[list[Coordinate], float]:
    """
    Generate a uniform 2D spatial lattice covering the buffered trip corridor.
    Using uniform cell spacing prevents route-overlap density spikes and gaps,
    returning `(grid_points, grid_spacing_miles)`.
    """
    sampled_polylines: list[list[Coordinate]] = []
    max_route_miles = 0.0

    for coords in routes_coordinates:
        if not coords:
            continue
        if len(coords) == 1:
            sampled_polylines.append(coords)
            continue

        cum = compute_cumulative_miles(coords)
        route_miles = cum[-1]
        if route_miles > max_route_miles:
            max_route_miles = route_miles

        # Subsample polyline to ~65 vertices for fast corridor distance checks
        stride = max(1, len(coords) // 65)
        reduced = coords[::stride]
        if reduced[-1] != coords[-1]:
            reduced = [*reduced, coords[-1]]
        sampled_polylines.append(reduced)

    if not sampled_polylines:
        return [], 10.0

    corridor_radius_miles = max(8.0, min(38.0, max_route_miles * 0.075))

    all_lats = [pt[0] for line in sampled_polylines for pt in line]
    all_lngs = [pt[1] for line in sampled_polylines for pt in line]
    mid_lat = (min(all_lats) + max(all_lats)) / 2.0
    cos_lat = max(math.cos(math.radians(mid_lat)), 0.15)

    pad_lat = corridor_radius_miles / 69.0
    pad_lng = corridor_radius_miles / (69.0 * cos_lat)
    min_lat = max(-85.0, min(all_lats) - pad_lat)
    max_lat = min(85.0, max(all_lats) + pad_lat)
    min_lng = min(all_lngs) - pad_lng
    max_lng = max(all_lngs) + pad_lng

    # Start with fine spacing relative to corridor width and adapt until <= target_points
    spacing_miles = max(3.5, corridor_radius_miles * 0.52)

    def _point_to_segment_miles(
        plat: float,
        plng: float,
        alat: float,
        alng: float,
        blat: float,
        blng: float,
    ) -> float:
        ax = alng * 69.0 * cos_lat
        ay = alat * 69.0
        bx = blng * 69.0 * cos_lat
        by = blat * 69.0
        px = plng * 69.0 * cos_lat
        py = plat * 69.0

        dx = bx - ax
        dy = by - ay
        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq <= 1e-9:
            return math.hypot(px - ax, py - ay)
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))
        proj_x = ax + t * dx
        proj_y = ay + t * dy
        return math.hypot(px - proj_x, py - proj_y)

    def _within_corridor(plat: float, plng: float) -> bool:
        for line in sampled_polylines:
            if len(line) == 1:
                if haversine_miles(plat, plng, line[0][0], line[0][1]) <= corridor_radius_miles:
                    return True
                continue
            for idx in range(len(line) - 1):
                if (
                    _point_to_segment_miles(
                        plat,
                        plng,
                        line[idx][0],
                        line[idx][1],
                        line[idx + 1][0],
                        line[idx + 1][1],
                    )
                    <= corridor_radius_miles
                ):
                    return True
        return False

    grid_points: list[Coordinate] = []
    for _ in range(12):
        dlat = spacing_miles / 69.0
        dlng = spacing_miles / (69.0 * cos_lat)
        lat_steps = max(1, int(math.ceil((max_lat - min_lat) / dlat)))
        lng_steps = max(1, int(math.ceil((max_lng - min_lng) / dlng)))

        # Quick upper-bound guard before testing segments
        if lat_steps * lng_steps > target_points * 8:
            spacing_miles *= 1.28
            continue

        candidate_points: list[Coordinate] = []
        for i in range(lat_steps + 1):
            lat = min_lat + i * dlat
            for j in range(lng_steps + 1):
                lng = min_lng + j * dlng
                if _within_corridor(lat, lng):
                    candidate_points.append((round(lat, 5), round(lng, 5)))

        grid_points = candidate_points
        if len(grid_points) <= target_points:
            break
        spacing_miles *= 1.22

    return grid_points[:target_points], round(spacing_miles, 2)


def build_corridor_heatmap_points(
    routes_coordinates: list[list[Coordinate]],
    max_points: int = 230,
) -> list[Coordinate]:
    """Backwards-compatible wrapper returning uniform corridor lattice coordinates."""
    points, _ = build_corridor_heatmap_grid(routes_coordinates, target_points=max_points)
    return points

