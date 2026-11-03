import type {
  HeatmapMetricOption,
  RiskLevel,
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

