"""Custom exceptions for external integrations and route planning."""


class TruckRoutingError(Exception):
    """Base error for weather-aware truck routing backend."""

    status_code = 400

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class ConfigurationError(TruckRoutingError):
    """Raised when required API credentials are missing."""

    status_code = 503


class GeocodingError(TruckRoutingError):
    """Raised when origin/destination geocoding fails or yields no results."""

    status_code = 400


class RoutingError(TruckRoutingError):
    """Raised when HERE Routing API fails or finds no drivable truck route."""

    status_code = 502


class WeatherServiceError(TruckRoutingError):
    """Raised when OpenWeather API requests fail."""

    status_code = 502

