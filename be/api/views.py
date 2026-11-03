"""HTTP endpoints for health check, geocoding autocomplete, and weather-aware route planning."""

from django.conf import settings
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.serializers import GeocodeQuerySerializer, RoutePlanRequestSerializer
from common.exceptions import TruckRoutingError
from integrations.here_client import geocode_suggestions
from services.route_planner import plan_weather_aware_routes


class HealthCheckView(APIView):
    """Lightweight readiness & API-key configuration status check."""

    def get(self, request: Request) -> Response:
        here_key = getattr(settings, "HERE_API_KEY", "")
        owm_key = getattr(settings, "OPENWEATHER_API_KEY", "")
        return Response(
            {
                "status": "ok",
                "here_configured": bool(here_key and here_key != "your_here_api_key_here"),
                "openweather_configured": bool(owm_key and owm_key != "your_openweather_api_key_here"),
                "openweather_mode": getattr(settings, "OPENWEATHER_MODE", "forecast25"),
            },
            status=status.HTTP_200_OK,
        )


class GeocodeSuggestView(APIView):
    """Autocomplete / geocoding lookup powered by HERE Geocoding & Search API."""

    def get(self, request: Request) -> Response:
        serializer = GeocodeQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)

        try:
            suggestions = geocode_suggestions(
                query=serializer.validated_data["q"],
                limit=serializer.validated_data["limit"],
            )
        except TruckRoutingError as exc:
            return Response({"error": exc.message}, status=exc.status_code)

        return Response({"results": suggestions}, status=status.HTTP_200_OK)


class RoutePlanView(APIView):
    """Compute 3 weather-aware truck routes, checkpoint risks, recommendation, and 0-48h heatmap."""

    def post(self, request: Request) -> Response:
        serializer = RoutePlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        try:
            result = plan_weather_aware_routes(
                origin_input=payload["origin"],
                destination_input=payload["destination"],
                departure_time=payload["departure_time"],
                load_weight_lb=payload["load_weight_lb"],
                interval_miles=int(payload["interval_miles"]),
            )
        except TruckRoutingError as exc:
            return Response({"error": exc.message}, status=exc.status_code)

        return Response(result, status=status.HTTP_200_OK)

