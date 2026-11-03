import type {
  HeatmapMetricOption,
  LoadEscalationRule,
  RiskLevel,
  RiskThresholdCells,
  SamplingIntervalMiles,
} from '../interfaces'

export const RISK_ORDER: readonly RiskLevel[] = [
  'Low',
  'Moderate',
  'High',
  'Severe',
  'No Travel',
] as const

export const SAMPLING_INTERVAL_OPTIONS: readonly SamplingIntervalMiles[] = [
  10,
  25,
  50,
] as const

export const HEATMAP_METRIC_OPTIONS: readonly HeatmapMetricOption[] = [
  { key: 'risk', label: 'Composite Risk' },
  { key: 'wind', label: 'Wind' },
  { key: 'rain', label: 'Rain' },
  { key: 'snow', label: 'Snow' },
] as const

export const RISK_COLORS: Record<RiskLevel, string> = {
  Low: '#22c55e',
  Moderate: '#eab308',
  High: '#f97316',
  Severe: '#ef4444',
  'No Travel': '#c026d3',
}

export const RISK_THRESHOLDS_BY_LEVEL: Record<RiskLevel, RiskThresholdCells> = {
  Low: {
    wind: '<25 mph',
    rain: '<0.10 in/hr',
    snow: '<0.5 in/hr',
    windCompact: '<25',
    rainCompact: '<0.10',
    snowCompact: '<0.5',
  },
  Moderate: {
    wind: '25–34 mph',
    rain: '0.10–0.25 in/hr',
    snow: '0.5–1.0 in/hr',
    windCompact: '25–34',
    rainCompact: '0.10–0.25',
    snowCompact: '0.5–1.0',
  },
  High: {
    wind: '35–44 mph',
    rain: '0.25–0.50 in/hr',
    snow: '1.0–2.0 in/hr',
    windCompact: '35–44',
    rainCompact: '0.25–0.50',
    snowCompact: '1.0–2.0',
  },
  Severe: {
    wind: '45–54 mph',
    rain: '0.50–1.00 in/hr',
    snow: '2.0–3.0 in/hr',
    windCompact: '45–54',
    rainCompact: '0.50–1.00',
    snowCompact: '2.0–3.0',
  },
  'No Travel': {
    wind: '≥55 mph',
    rain: '>1.00 in/hr',
    snow: '>3.0 in/hr',
    windCompact: '≥55',
    rainCompact: '>1.00',
    snowCompact: '>3.0',
  },
}

export const LOAD_ESCALATION_RULES: readonly LoadEscalationRule[] = [
  { condition: '≥55 mph wind', load: 'Any load', result: 'No Travel' },
  { condition: '45–54 mph wind', load: '>30,000 lb', result: 'No Travel' },
  { condition: '35–44 mph wind', load: '>40,000 lb', result: 'Severe' },
] as const

export const MAP_STYLES = {
  night: {
    label: 'Night Nav',
    url:
      (import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined)?.trim() ||
      'mapbox://styles/mapbox/navigation-night-v1',
  },
  day: {
    label: 'Day Nav',
    url: 'mapbox://styles/mapbox/navigation-day-v1',
  },
} as const

export type MapStyleKey = keyof typeof MAP_STYLES

