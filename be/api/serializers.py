"""DRF serializers for geocoding and weather-aware truck route planning requests."""

from typing import Any

from rest_framework import serializers

from common.constants import (
    DEFAULT_SAMPLING_INTERVAL_MILES,
    VALID_SAMPLING_INTERVALS_MILES,
)


class LocationInputField(serializers.Field):
    """
    Accepts either a plain text address/city string (e.g. "Chicago, IL")
    or a structured coordinate object `{"label": "...", "lat": 41.88, "lng": -87.63}`.
    """

    def to_internal_value(self, data: Any) -> str | dict[str, Any]:
        if isinstance(data, str):
            cleaned = data.strip()
            if not cleaned:
                raise serializers.ValidationError("Location text cannot be empty.")
            if len(cleaned) > 250:
                raise serializers.ValidationError("Location text must be 250 characters or fewer.")
            return cleaned

        if isinstance(data, dict):
            has_coords = "lat" in data and "lng" in data and data["lat"] is not None and data["lng"] is not None
            label = str(data.get("label") or "").strip()

            if not has_coords and not label:
                raise serializers.ValidationError(
                    "Location object must include either 'lat'/'lng' coordinates or a non-empty 'label'."
                )

            if has_coords:
                try:
                    lat = float(data["lat"])
                    lng = float(data["lng"])
                except (TypeError, ValueError) as exc:
                    raise serializers.ValidationError("Coordinates 'lat' and 'lng' must be numbers.") from exc

                if not (-90.0 <= lat <= 90.0):
                    raise serializers.ValidationError("Latitude must be between -90 and 90.")
                if not (-180.0 <= lng <= 180.0):
                    raise serializers.ValidationError("Longitude must be between -180 and 180.")

                return {
                    "label": label or f"{lat:.4f}, {lng:.4f}",
                    "lat": lat,
                    "lng": lng,
                }

            return label

        raise serializers.ValidationError(
            "Location must be an address string or an object containing {label, lat, lng}."
        )


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=250)
    limit = serializers.IntegerField(min_value=1, max_value=10, required=False, default=5)


class RoutePlanRequestSerializer(serializers.Serializer):
    origin = LocationInputField()
    destination = LocationInputField()
    departure_time = serializers.DateTimeField(required=False, allow_null=True, default=None)
    load_weight_lb = serializers.FloatField(min_value=0.0, max_value=200_000.0)
    interval_miles = serializers.ChoiceField(
        choices=list(VALID_SAMPLING_INTERVALS_MILES),
        required=False,
        default=DEFAULT_SAMPLING_INTERVAL_MILES,
    )

