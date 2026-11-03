from django.urls import path

from api.views import GeocodeSuggestView, HealthCheckView, RoutePlanView

urlpatterns = [
    path("health/", HealthCheckView.as_view(), name="api-health"),
    path("geocode/", GeocodeSuggestView.as_view(), name="api-geocode"),
    path("routes/plan/", RoutePlanView.as_view(), name="api-routes-plan"),
]

