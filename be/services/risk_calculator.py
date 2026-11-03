"""Weather and load-weight risk classification per Spotter specification."""

from typing import Any

from common.constants import (
    LOAD_NO_TRAVEL_WIND_45_54_LB,
    LOAD_SEVERE_WIND_35_44_LB,
    RAIN_HIGH_MIN_IN_HR,
    RAIN_MODERATE_MIN_IN_HR,
    RAIN_NO_TRAVEL_GT_IN_HR,
    RAIN_SEVERE_MIN_IN_HR,
    RISK_HIGH,
    RISK_LOW,
    RISK_MODERATE,
    RISK_NO_TRAVEL,
    RISK_SCORES,
    RISK_SEVERE,
    SCORE_TO_RISK,
    SNOW_HIGH_MIN_IN_HR,
    SNOW_MODERATE_MIN_IN_HR,
    SNOW_NO_TRAVEL_GT_IN_HR,
    SNOW_SEVERE_MIN_IN_HR,
    WIND_HIGH_MIN_MPH,
    WIND_MODERATE_MIN_MPH,
    WIND_NO_TRAVEL_MIN_MPH,
    WIND_SEVERE_MIN_MPH,
)


def classify_base_wind_risk(wind_mph: float) -> str:
    """Classify wind speed (mph) before load-weight escalation."""
    wind = max(0.0, float(wind_mph))
    if wind >= WIND_NO_TRAVEL_MIN_MPH:
        return RISK_NO_TRAVEL
    if wind >= WIND_SEVERE_MIN_MPH:
        return RISK_SEVERE
    if wind >= WIND_HIGH_MIN_MPH:
        return RISK_HIGH
    if wind >= WIND_MODERATE_MIN_MPH:
        return RISK_MODERATE
    return RISK_LOW


def classify_wind_with_load(wind_mph: float, load_weight_lb: float) -> tuple[str, bool]:
    """
    Classify wind risk including load-weight escalation rules:
      - >= 55 mph -> No Travel for any load
      - 45-54 mph + > 30,000 lb -> No Travel
      - 35-44 mph + > 40,000 lb -> Severe

    Returns (wind_risk_level, load_rule_triggered).
    """
    wind = max(0.0, float(wind_mph))
    weight = max(0.0, float(load_weight_lb))
    base_risk = classify_base_wind_risk(wind)

    if wind >= WIND_NO_TRAVEL_MIN_MPH:
        return RISK_NO_TRAVEL, False

    if WIND_SEVERE_MIN_MPH <= wind < WIND_NO_TRAVEL_MIN_MPH and weight > LOAD_NO_TRAVEL_WIND_45_54_LB:
        return RISK_NO_TRAVEL, True

    if WIND_HIGH_MIN_MPH <= wind < WIND_SEVERE_MIN_MPH and weight > LOAD_SEVERE_WIND_35_44_LB:
        return RISK_SEVERE, True

    return base_risk, False


def classify_rain_risk(rain_in_hr: float) -> str:
    """Classify hourly rainfall rate (in/hr)."""
    rain = max(0.0, float(rain_in_hr))
    if rain > RAIN_NO_TRAVEL_GT_IN_HR:
        return RISK_NO_TRAVEL
    if rain >= RAIN_SEVERE_MIN_IN_HR:
        return RISK_SEVERE
    if rain >= RAIN_HIGH_MIN_IN_HR:
        return RISK_HIGH
    if rain >= RAIN_MODERATE_MIN_IN_HR:
        return RISK_MODERATE
    return RISK_LOW


def classify_snow_risk(snow_in_hr: float) -> str:
    """Classify hourly snowfall accumulation rate (in/hr)."""
    snow = max(0.0, float(snow_in_hr))
    if snow > SNOW_NO_TRAVEL_GT_IN_HR:
        return RISK_NO_TRAVEL
    if snow >= SNOW_SEVERE_MIN_IN_HR:
        return RISK_SEVERE
    if snow >= SNOW_HIGH_MIN_IN_HR:
        return RISK_HIGH
    if snow >= SNOW_MODERATE_MIN_IN_HR:
        return RISK_MODERATE
    return RISK_LOW


def evaluate_checkpoint_risk(
    wind_mph: float,
    rain_in_hr: float,
    snow_in_hr: float,
    load_weight_lb: float,
) -> dict[str, Any]:
    """
    Evaluate per-condition and composite weather risk at a checkpoint.
    Composite risk is the worst (maximum) tier across Wind (with load rules), Rain, and Snow.
    """
    base_wind_risk = classify_base_wind_risk(wind_mph)
    wind_risk, load_rule_triggered = classify_wind_with_load(wind_mph, load_weight_lb)
    rain_risk = classify_rain_risk(rain_in_hr)
    snow_risk = classify_snow_risk(snow_in_hr)

    max_score = max(
        RISK_SCORES[wind_risk],
        RISK_SCORES[rain_risk],
        RISK_SCORES[snow_risk],
    )
    overall_risk = SCORE_TO_RISK[max_score]

    return {
        "risk_level": overall_risk,
        "risk_score": max_score,
        "wind_risk": wind_risk,
        "base_wind_risk": base_wind_risk,
        "rain_risk": rain_risk,
        "snow_risk": snow_risk,
        "load_rule_triggered": load_rule_triggered,
    }

