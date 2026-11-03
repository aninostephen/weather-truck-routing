"""Unit tests for Spotter weather thresholds and load-weight escalation rules."""

from django.test import SimpleTestCase

from common.constants import (
    RISK_HIGH,
    RISK_LOW,
    RISK_MODERATE,
    RISK_NO_TRAVEL,
    RISK_SEVERE,
)
from services.risk_calculator import (
    classify_base_wind_risk,
    classify_rain_risk,
    classify_snow_risk,
    classify_wind_with_load,
    evaluate_checkpoint_risk,
)


class RiskCalculatorTests(SimpleTestCase):
    def test_wind_base_thresholds(self):
        self.assertEqual(classify_base_wind_risk(0), RISK_LOW)
        self.assertEqual(classify_base_wind_risk(24.9), RISK_LOW)
        self.assertEqual(classify_base_wind_risk(25.0), RISK_MODERATE)
        self.assertEqual(classify_base_wind_risk(34.9), RISK_MODERATE)
        self.assertEqual(classify_base_wind_risk(35.0), RISK_HIGH)
        self.assertEqual(classify_base_wind_risk(44.9), RISK_HIGH)
        self.assertEqual(classify_base_wind_risk(45.0), RISK_SEVERE)
        self.assertEqual(classify_base_wind_risk(54.9), RISK_SEVERE)
        self.assertEqual(classify_base_wind_risk(55.0), RISK_NO_TRAVEL)
        self.assertEqual(classify_base_wind_risk(68.0), RISK_NO_TRAVEL)

    def test_rain_thresholds(self):
        self.assertEqual(classify_rain_risk(0.0), RISK_LOW)
        self.assertEqual(classify_rain_risk(0.09), RISK_LOW)
        self.assertEqual(classify_rain_risk(0.10), RISK_MODERATE)
        self.assertEqual(classify_rain_risk(0.24), RISK_MODERATE)
        self.assertEqual(classify_rain_risk(0.25), RISK_HIGH)
        self.assertEqual(classify_rain_risk(0.49), RISK_HIGH)
        self.assertEqual(classify_rain_risk(0.50), RISK_SEVERE)
        self.assertEqual(classify_rain_risk(1.00), RISK_SEVERE)
        self.assertEqual(classify_rain_risk(1.01), RISK_NO_TRAVEL)

    def test_snow_thresholds(self):
        self.assertEqual(classify_snow_risk(0.0), RISK_LOW)
        self.assertEqual(classify_snow_risk(0.49), RISK_LOW)
        self.assertEqual(classify_snow_risk(0.50), RISK_MODERATE)
        self.assertEqual(classify_snow_risk(0.99), RISK_MODERATE)
        self.assertEqual(classify_snow_risk(1.00), RISK_HIGH)
        self.assertEqual(classify_snow_risk(1.99), RISK_HIGH)
        self.assertEqual(classify_snow_risk(2.00), RISK_SEVERE)
        self.assertEqual(classify_snow_risk(3.00), RISK_SEVERE)
        self.assertEqual(classify_snow_risk(3.01), RISK_NO_TRAVEL)

    def test_load_weight_escalation_rules(self):
        # >= 55 mph -> No Travel for any load
        risk, escalated = classify_wind_with_load(55.0, load_weight_lb=0)
        self.assertEqual(risk, RISK_NO_TRAVEL)
        self.assertFalse(escalated)

        # 45-54 mph + <= 30,000 lb stays Severe; > 30,000 lb escalates to No Travel
        risk_at_limit, escalated_at_limit = classify_wind_with_load(48.0, load_weight_lb=30_000)
        self.assertEqual(risk_at_limit, RISK_SEVERE)
        self.assertFalse(escalated_at_limit)

        risk_over, escalated_over = classify_wind_with_load(48.0, load_weight_lb=30_001)
        self.assertEqual(risk_over, RISK_NO_TRAVEL)
        self.assertTrue(escalated_over)

        # 35-44 mph + <= 40,000 lb stays High; > 40,000 lb escalates to Severe
        risk_40k, esc_40k = classify_wind_with_load(38.0, load_weight_lb=40_000)
        self.assertEqual(risk_40k, RISK_HIGH)
        self.assertFalse(esc_40k)

        risk_42k, esc_42k = classify_wind_with_load(38.0, load_weight_lb=42_000)
        self.assertEqual(risk_42k, RISK_SEVERE)
        self.assertTrue(esc_42k)

    def test_composite_checkpoint_picks_worst_hazard(self):
        result = evaluate_checkpoint_risk(
            wind_mph=40.0,
            rain_in_hr=0.05,
            snow_in_hr=0.2,
            load_weight_lb=45_000,
        )
        self.assertEqual(result["base_wind_risk"], RISK_HIGH)
        self.assertEqual(result["wind_risk"], RISK_SEVERE)
        self.assertEqual(result["risk_level"], RISK_SEVERE)
        self.assertEqual(result["risk_score"], 3)
        self.assertTrue(result["load_rule_triggered"])

