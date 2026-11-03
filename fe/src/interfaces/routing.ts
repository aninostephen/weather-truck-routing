export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Severe' | 'No Travel'

export type SamplingIntervalMiles = 10 | 25 | 50

export type HeatmapMetric = 'risk' | 'wind' | 'rain' | 'snow'

export interface LocationPoint {
  label: string
  lat: number
  lng: number
  city?: string | null
  state?: string | null
  country?: string | null
}

export interface CheckpointWeather {
  wind_mph: number
  rain_in_hr: number
  snow_in_hr: number
}

export interface RouteCheckpoint {
  index: number
  lat: number
  lng: number
  distance_miles: number
  segment_miles: number
  eta: string
  weather: CheckpointWeather
  risk_level: RiskLevel
  risk_score: number
  wind_risk: RiskLevel
  base_wind_risk: RiskLevel
  rain_risk: RiskLevel
  snow_risk: RiskLevel
  load_rule_triggered: boolean
}

export interface RouteRiskSummary {
  overall_risk_level: RiskLevel
  max_risk_score: number
  average_risk: number
  no_travel_miles: number
  severe_miles: number
  high_miles: number
  miles_by_risk: Record<RiskLevel, number>
  checkpoint_counts: Record<RiskLevel, number>
  has_no_travel: boolean
  total_distance_miles: number
}

export interface RouteLineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface AnalyzedRoute {
  id: string
  name: string
  road_labels: string[]
  distance_miles: number
  duration_seconds: number
  duration_minutes: number
  eta: string
  rank: number
  is_recommended: boolean
  geometry: RouteLineStringGeometry
  risk_summary: RouteRiskSummary
  checkpoints: RouteCheckpoint[]
}

export interface HeatmapHourFrame {
  hour_offset: number
  timestamp: string
  /** Compact tuple per point: [intensity, risk_score, wind_mph, rain_in_hr, snow_in_hr] */
  values: [number, number, number, number, number][]
}

export interface CorridorHeatmap {
  anchor_time: string
  max_hours: number
  grid_spacing_miles?: number
  value_fields: string[]
  points: { lat: number; lng: number }[]
  hours: HeatmapHourFrame[]
}

export interface GeocodeResponse {
  results: LocationPoint[]
}

export interface RoutePlanRequest {
  origin: string | LocationPoint
  destination: string | LocationPoint
  departure_time?: string | null
  load_weight_lb: number
  interval_miles: SamplingIntervalMiles
}

export interface HealthStatusResponse {
  status: string
  here_configured: boolean
  openweather_configured: boolean
  openweather_mode: string
}

export interface RoutePlanResponse {
  origin: LocationPoint
  destination: LocationPoint
  departure_time: string
  load_weight_lb: number
  interval_miles: SamplingIntervalMiles
  recommended_route_id: string | null
  recommendation_reason: string
  has_no_travel_advisory: boolean
  weather_stations_queried: number
  routes: AnalyzedRoute[]
  corridor_heatmap: CorridorHeatmap
}

