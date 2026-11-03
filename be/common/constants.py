"""Shared domain constants, risk thresholds, and unit conversion factors."""

RISK_LOW = "Low"
RISK_MODERATE = "Moderate"
RISK_HIGH = "High"
RISK_SEVERE = "Severe"
RISK_NO_TRAVEL = "No Travel"

RISK_LEVELS = (
    RISK_LOW,
    RISK_MODERATE,
    RISK_HIGH,
    RISK_SEVERE,
    RISK_NO_TRAVEL,
)

RISK_SCORES = {
    RISK_LOW: 0,
    RISK_MODERATE: 1,
    RISK_HIGH: 2,
    RISK_SEVERE: 3,
    RISK_NO_TRAVEL: 4,
}

SCORE_TO_RISK = {score: level for level, score in RISK_SCORES.items()}

# Wind thresholds (mph)
WIND_MODERATE_MIN_MPH = 25.0
WIND_HIGH_MIN_MPH = 35.0
WIND_SEVERE_MIN_MPH = 45.0
WIND_NO_TRAVEL_MIN_MPH = 55.0

# Rain thresholds (in/hr)
RAIN_MODERATE_MIN_IN_HR = 0.10
RAIN_HIGH_MIN_IN_HR = 0.25
RAIN_SEVERE_MIN_IN_HR = 0.50
RAIN_NO_TRAVEL_GT_IN_HR = 1.00

# Snow thresholds (in/hr of accumulation depth)
SNOW_MODERATE_MIN_IN_HR = 0.5
SNOW_HIGH_MIN_IN_HR = 1.0
SNOW_SEVERE_MIN_IN_HR = 2.0
SNOW_NO_TRAVEL_GT_IN_HR = 3.0

# Load weight escalation thresholds (lb)
LOAD_NO_TRAVEL_WIND_45_54_LB = 30_000.0
LOAD_SEVERE_WIND_35_44_LB = 40_000.0

# Empty tractor-trailer tare weight used for HERE vehicle[grossWeight]
TRACTOR_TARE_WEIGHT_LB = 30_000.0

# Unit conversions
LB_TO_KG = 0.45359237
METERS_TO_MILES = 0.000621371192
EARTH_RADIUS_MILES = 3958.7613
MM_TO_INCHES = 1.0 / 25.4
SNOW_TO_LIQUID_RATIO = 10.0

# Sampling & heatmap parameters
VALID_SAMPLING_INTERVALS_MILES = (10, 25, 50)
DEFAULT_SAMPLING_INTERVAL_MILES = 25
FORECAST_SLIDER_HOURS = 48
MAX_WEATHER_GRID_POINTS = 32
WEATHER_CACHE_TTL_SECONDS = 1800

