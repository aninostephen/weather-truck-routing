"""Unit tests for route risk aggregation and lexicographical tie-breaker recommendation."""

from django.test import SimpleTestCase

from common.constants import (
    RISK_HIGH,
    RISK_LOW,
    RISK_MODERATE,
    RISK_NO_TRAVEL,
    RISK_SEVERE,
)
from services.recommendation import select_recommended_route, summarize_route_risk


def _make_route(
    route_id: str,
    duration_seconds: float,
    no_travel_mi: float = 0.0,
    severe_mi: float = 0.0,
    high_mi: float = 0.0,
    avg_risk: float = 0.0,
) -> dict:
    return {
        "id": route_id,
        "name": f"Option {route_id}",
        "duration_seconds": duration_seconds,
        "risk_summary": {
            "no_travel_miles": no_travel_mi,
            "severe_miles": severe_mi,
            "high_miles": high_mi,
            "average_risk": avg_risk,
            "has_no_travel": no_travel_mi > 0,
        },
    }


class RecommendationTests(SimpleTestCase):
    def test_prefers_fewest_no_travel_miles_first(self):
        routes = [
            _make_route("r1", duration_seconds=3000, no_travel_mi=10, severe_mi=0, avg_risk=0.4),
            _make_route("r2", duration_seconds=5000, no_travel_mi=0, severe_mi=25, avg_risk=1.8),
        ]
        winner_id, _, advisory = select_recommended_route(routes)
        self.assertEqual(winner_id, "r2")
        self.assertFalse(advisory)

    def test_prefers_fewest_severe_miles_over_high_and_time(self):
        routes = [
            _make_route("r1", duration_seconds=3600, severe_mi=20, high_mi=0, avg_risk=0.5),
            _make_route("r2", duration_seconds=4800, severe_mi=10, high_mi=50, avg_risk=1.9),
        ]
        winner_id, _, _ = select_recommended_route(routes)
        self.assertEqual(winner_id, "r2")

    def test_prefers_fewest_high_miles_when_severe_tied(self):
        routes = [
            _make_route("r1", duration_seconds=3600, severe_mi=0, high_mi=40, avg_risk=0.8),
            _make_route("r2", duration_seconds=4200, severe_mi=0, high_mi=15, avg_risk=1.1),
        ]
        winner_id, _, _ = select_recommended_route(routes)
        self.assertEqual(winner_id, "r2")

    def test_prefers_lowest_average_risk_when_severe_and_high_tied(self):
        routes = [
            _make_route("r1", duration_seconds=3600, severe_mi=0, high_mi=0, avg_risk=0.85),
            _make_route("r2", duration_seconds=4000, severe_mi=0, high_mi=0, avg_risk=0.30),
        ]
        winner_id, _, _ = select_recommended_route(routes)
        self.assertEqual(winner_id, "r2")

    def test_prefers_shortest_travel_time_as_final_tiebreaker(self):
        routes = [
            _make_route("r1", duration_seconds=4500, severe_mi=0, high_mi=10, avg_risk=0.50),
            _make_route("r2", duration_seconds=3900, severe_mi=0, high_mi=10, avg_risk=0.50),
        ]
        winner_id, _, _ = select_recommended_route(routes)
        self.assertEqual(winner_id, "r2")

    def test_flags_advisory_when_all_routes_have_no_travel(self):
        routes = [
            _make_route("r1", duration_seconds=3600, no_travel_mi=30, severe_mi=10, avg_risk=2.5),
            _make_route("r2", duration_seconds=4100, no_travel_mi=12, severe_mi=20, avg_risk=2.2),
        ]
        winner_id, reason, advisory = select_recommended_route(routes)
        self.assertEqual(winner_id, "r2")
        self.assertTrue(advisory)
        self.assertIn("No Travel Advisory", reason)

    def test_summarize_route_risk_weighted_miles(self):
        checkpoints = [
            {"risk_level": RISK_LOW, "risk_score": 0, "segment_miles": 25.0},
            {"risk_level": RISK_MODERATE, "risk_score": 1, "segment_miles": 25.0},
            {"risk_level": RISK_HIGH, "risk_score": 2, "segment_miles": 25.0},
            {"risk_level": RISK_SEVERE, "risk_score": 3, "segment_miles": 25.0},
        ]
        summary = summarize_route_risk(checkpoints, total_distance_miles=100.0)
        self.assertEqual(summary["overall_risk_level"], RISK_SEVERE)
        self.assertEqual(summary["severe_miles"], 25.0)
        self.assertEqual(summary["high_miles"], 25.0)
        self.assertEqual(summary["no_travel_miles"], 0.0)
        self.assertAlmostEqual(summary["average_risk"], 1.5, places=3)
        self.assertEqual(summary["miles_by_risk"][RISK_NO_TRAVEL], 0.0)

