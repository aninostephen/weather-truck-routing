"""Integration tests for /api/health/, /api/geocode/, and /api/routes/plan/."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
import flexpolyline
from rest_framework.test import APIClient


def _mock_here_route(coords: list[tuple[float, float]], duration_s: int, length_m: int, road: str) -> dict:
    return {
        "sections": [
            {
                "polyline": flexpolyline.encode(coords),
                "summary": {"duration": duration_s, "length": length_m},
                "routeLabels": [{"attributes": {"names": [{"value": road}]}}],
            }
        ]
    }


@override_settings(
    HERE_API_KEY="test-here-key",
    HERE_GEOCODE_URL="https://geocode.search.hereapi.com/v1/geocode",
    HERE_AUTOSUGGEST_URL="https://autosuggest.search.hereapi.com/v1/autosuggest",
    HERE_ROUTES_URL="https://router.hereapi.com/v8/routes",
    OPENWEATHER_API_KEY="test-owm-key",
    OPENWEATHER_MODE="forecast25",
    OPENWEATHER_FORECAST_25_URL="https://api.openweathermap.org/data/2.5/forecast",
    OPENWEATHER_ONECALL_30_URL="https://api.openweathermap.org/data/3.0/onecall",
)
class ApiEndpointTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_health_endpoint(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertTrue(data["here_configured"])
        self.assertTrue(data["openweather_configured"])

    @patch("integrations.here_client.requests.get")
    def test_geocode_endpoint(self, mock_get: MagicMock):
        mock_resp = MagicMock(ok=True, status_code=200)
        mock_resp.json.return_value = {
            "items": [
                {
                    "title": "Chicago, IL, United States",
                    "address": {
                        "label": "Chicago, IL, United States",
                        "city": "Chicago",
                        "stateCode": "IL",
                        "countryCode": "USA",
                    },
                    "position": {"lat": 41.88425, "lng": -87.63245},
                }
            ]
        }
        mock_get.return_value = mock_resp

        response = self.client.get("/api/geocode/", {"q": "Chicago"})
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["city"], "Chicago")
        self.assertAlmostEqual(results[0]["lat"], 41.88425)

    def test_route_plan_rejects_invalid_interval(self):
        response = self.client.post(
            "/api/routes/plan/",
            {
                "origin": {"label": "Chicago, IL", "lat": 41.88, "lng": -87.63},
                "destination": {"label": "Milwaukee, WI", "lat": 43.04, "lng": -87.91},
                "load_weight_lb": 35000,
                "interval_miles": 15,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    @patch("requests.get")
    def test_route_plan_end_to_end_ranking_and_heatmap(
        self,
        mock_http_get: MagicMock,
    ):
        departure_dt = datetime.now(timezone.utc) + timedelta(hours=1)
        base_ts = int(departure_dt.timestamp())
        seen_here_params: list[dict] = []

        # Route 1 (west corridor, faster, ~90 mi) -> hits 50 mph wind + 35k lb => No Travel!
        # Route 2 (center corridor, medium, ~95 mi) -> calm 12 mph wind => Recommended!
        # Route 3 (east corridor, slower, ~102 mi) -> calm 12 mph wind, loses on travel time
        here_payload = {
            "routes": [
                _mock_here_route(
                    [(41.88, -87.63), (42.45, -88.45), (43.04, -87.91)],
                    duration_s=5400,
                    length_m=145000,
                    road="I-90 W",
                ),
                _mock_here_route(
                    [(41.88, -87.63), (42.45, -87.77), (43.04, -87.91)],
                    duration_s=5800,
                    length_m=153000,
                    road="I-94 W",
                ),
                _mock_here_route(
                    [(41.88, -87.63), (42.45, -87.10), (43.04, -87.91)],
                    duration_s=6400,
                    length_m=164000,
                    road="US-41 N",
                ),
            ]
        }

        def _http_router(url, params=None, timeout=None):
            resp = MagicMock(ok=True, status_code=200)
            if "hereapi.com" in url:
                seen_here_params.append(dict(params or {}))
                resp.json.return_value = here_payload
                return resp

            lon = float(params["lon"])
            # Western corridor experiences dangerous 50 mph wind; eastern/central stays calm (12 mph)
            wind_speed = 50.0 if lon <= -88.20 else 12.0
            resp.json.return_value = {
                "list": [
                    {
                        "dt": base_ts + step * 10800,
                        "wind": {"speed": wind_speed},
                        "rain": {"3h": 0.0},
                        "snow": {"3h": 0.0},
                    }
                    for step in range(20)
                ]
            }
            return resp

        mock_http_get.side_effect = _http_router

        response = self.client.post(
            "/api/routes/plan/",
            {
                "origin": {"label": "Chicago, IL", "lat": 41.88, "lng": -87.63},
                "destination": {"label": "Milwaukee, WI", "lat": 43.04, "lng": -87.91},
                "departure_time": departure_dt.isoformat(),
                "load_weight_lb": 35_000,
                "interval_miles": 25,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(len(body["routes"]), 3)
        # Route 2 (I-94 W) avoids the western 50 mph + 35,000 lb No Travel wind zone and beats Route 3 on time
        self.assertEqual(body["recommended_route_id"], "route-2")
        self.assertFalse(body["has_no_travel_advisory"])
        self.assertEqual(body["routes"][0]["id"], "route-2")
        self.assertTrue(body["routes"][0]["is_recommended"])

        # Check GeoJSON [lng, lat] order
        first_coord = body["routes"][0]["geometry"]["coordinates"][0]
        self.assertAlmostEqual(first_coord[0], -87.63, places=2)
        self.assertAlmostEqual(first_coord[1], 41.88, places=2)

        # Check HERE truck parameters (30,000 lb tare + 35,000 lb load -> kg)
        self.assertEqual(seen_here_params[0]["transportMode"], "truck")
        self.assertEqual(seen_here_params[0]["alternatives"], 2)
        self.assertEqual(seen_here_params[0]["vehicle[grossWeight]"], round(65_000 * 0.45359237))

        # Check 0-48h corridor heatmap structure (49 hourly frames: 0..48)
        heatmap = body["corridor_heatmap"]
        self.assertEqual(heatmap["max_hours"], 48)
        self.assertEqual(len(heatmap["hours"]), 49)
        self.assertGreater(len(heatmap["points"]), 0)
        self.assertEqual(len(heatmap["hours"][0]["values"]), len(heatmap["points"]))

    def test_openweather_rain_and_snow_unit_conversions(self):
        from integrations.openweather_client import (
            _parse_forecast25_payload,
            _parse_onecall30_payload,
        )

        # 7.62 mm of rain over 3h -> 2.54 mm/hr -> 0.10 in/hr (Moderate threshold)
        # 7.62 mm liquid snow over 3h -> 2.54 mm/hr * 10 SLR = 25.4 mm/hr snow -> 1.0 in/hr snow (High threshold)
        parsed_25 = _parse_forecast25_payload(
            {
                "list": [
                    {
                        "dt": 1700000000,
                        "wind": {"speed": 28.5},
                        "rain": {"3h": 7.62},
                        "snow": {"3h": 7.62},
                    }
                ]
            }
        )
        self.assertAlmostEqual(parsed_25[0]["wind_mph"], 28.5)
        self.assertAlmostEqual(parsed_25[0]["rain_in_hr"], 0.10, places=4)
        self.assertAlmostEqual(parsed_25[0]["snow_in_hr"], 1.00, places=4)

        parsed_30 = _parse_onecall30_payload(
            {
                "hourly": [
                    {
                        "dt": 1700000000,
                        "wind_speed": 42.0,
                        "rain": {"1h": 12.7},   # 0.50 in/hr
                        "snow": {"1h": 5.08},   # 2.00 in/hr (at 10:1 SLR)
                    }
                ]
            }
        )
        self.assertAlmostEqual(parsed_30[0]["wind_mph"], 42.0)
        self.assertAlmostEqual(parsed_30[0]["rain_in_hr"], 0.50, places=4)
        self.assertAlmostEqual(parsed_30[0]["snow_in_hr"], 2.00, places=4)

    @patch("integrations.here_client.requests.get")
    def test_three_route_fallback_when_primary_returns_single_route(self, mock_get: MagicMock):
        from integrations.here_client import fetch_truck_routes

        call_count = 0
        distinct_corridors = [
            [(41.88, -87.63), (42.45, -87.77), (43.04, -87.91)],
            [(41.88, -87.63), (42.45, -88.45), (43.04, -87.91)],
            [(41.88, -87.63), (42.45, -87.05), (43.04, -87.91)],
        ]

        def _here_fallback_side_effect(url, params=None, timeout=None):
            nonlocal call_count
            coords = distinct_corridors[min(call_count, 2)]
            length_m = 150000 + call_count * 12000
            call_count += 1
            resp = MagicMock(ok=True, status_code=200)
            resp.json.return_value = {
                "routes": [_mock_here_route(coords, duration_s=5500, length_m=length_m, road=f"HWY-{call_count}")]
            }
            return resp

        mock_get.side_effect = _here_fallback_side_effect

        routes = fetch_truck_routes(
            origin={"lat": 41.88, "lng": -87.63, "label": "A"},
            destination={"lat": 43.04, "lng": -87.91, "label": "B"},
            departure_time=datetime.now(timezone.utc),
            load_weight_lb=20_000,
            target_count=3,
        )
        self.assertEqual(len(routes), 3)
        self.assertEqual([r["id"] for r in routes], ["route-1", "route-2", "route-3"])

