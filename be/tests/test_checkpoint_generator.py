"""Unit tests for polyline checkpoint sampling, ETA interpolation, and corridor grid bounds."""

from datetime import datetime, timezone

from django.test import SimpleTestCase

from common.constants import MAX_WEATHER_GRID_POINTS
from services.checkpoint_generator import (
    build_weather_station_grid,
    compute_cumulative_miles,
    sample_route_checkpoints,
)


class CheckpointGeneratorTests(SimpleTestCase):
    def setUp(self):
        # Roughly ~138 miles north-south along longitude -87.6
        self.coords = [
            (40.0, -87.6),
            (41.0, -87.6),
            (42.0, -87.6),
        ]
        self.departure = datetime(2026, 11, 4, 8, 0, 0, tzinfo=timezone.utc)
        self.duration_s = 7200.0  # 2 hours

    def test_sampling_intervals_and_segment_sum_conservation(self):
        total_miles = compute_cumulative_miles(self.coords)[-1]

        for interval in (10, 25, 50):
            checkpoints = sample_route_checkpoints(
                coordinates=self.coords,
                total_duration_seconds=self.duration_s,
                departure_time=self.departure,
                interval_miles=interval,
            )
            self.assertGreaterEqual(len(checkpoints), 3)
            self.assertEqual(checkpoints[0]["distance_miles"], 0.0)
            self.assertEqual(checkpoints[1]["distance_miles"], float(interval))
            self.assertAlmostEqual(checkpoints[-1]["distance_miles"], total_miles, places=1)

            # Segment weights must partition the entire route length
            seg_sum = sum(cp["segment_miles"] for cp in checkpoints)
            self.assertAlmostEqual(seg_sum, total_miles, places=3)

            # Origin & destination ETAs must match departure and arrival
            self.assertEqual(checkpoints[0]["eta"], self.departure.isoformat())
            self.assertAlmostEqual(
                checkpoints[-1]["eta_timestamp"] - checkpoints[0]["eta_timestamp"],
                self.duration_s,
                places=2,
            )

    def test_corridor_station_grid_respects_max_cap_on_cross_country_routes(self):
        # ~2,000-mile cross-country corridor (Chicago -> Los Angeles)
        route_a = [(41.88 - 0.35 * i, -87.63 - 1.5 * i) for i in range(21)]
        route_b = [(41.88 - 0.32 * i, -87.63 - 1.5 * i) for i in range(21)]
        route_c = [(41.88 - 0.38 * i, -87.63 - 1.5 * i) for i in range(21)]

        stations = build_weather_station_grid([route_a, route_b, route_c])
        self.assertGreater(len(stations), 0)
        self.assertLessEqual(len(stations), MAX_WEATHER_GRID_POINTS)

