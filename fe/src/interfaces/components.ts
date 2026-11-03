import type {
  AnalyzedRoute,
  CorridorHeatmap,
  HeatmapMetric,
  LocationPoint,
  RouteCheckpoint,
  SamplingIntervalMiles,
} from './routing'

export interface LocationValue {
  text: string
  point: LocationPoint | null
}

export interface LocationInputProps {
  id: string
  label: string
  placeholder: string
  dotColor: string
  value: LocationValue
  onChange: (next: LocationValue) => void
}

export interface TripFormProps {
  origin: LocationValue
  destination: LocationValue
  departureLocal: string
  loadWeightLb: string
  intervalMiles: SamplingIntervalMiles
  loading: boolean
  onChangeOrigin: (val: LocationValue) => void
  onChangeDestination: (val: LocationValue) => void
  onSwapLocations: () => void
  onChangeDeparture: (val: string) => void
  onChangeLoadWeight: (val: string) => void
  onChangeInterval: (interval: SamplingIntervalMiles) => void
  onSubmit: (event: React.FormEvent) => void
}

export interface RouteCardProps {
  route: AnalyzedRoute
  isSelected: boolean
  onSelect: (routeId: string) => void
}

export interface CheckpointListProps {
  routeName: string
  intervalMiles: number
  checkpoints: RouteCheckpoint[]
  focusedCheckpointIndex: number | null
  onFocusCheckpoint: (checkpoint: RouteCheckpoint) => void
}

export interface HeatmapMetricOption {
  key: HeatmapMetric
  label: string
}

export interface ForecastSliderProps {
  corridorHeatmap: CorridorHeatmap
  forecastHour: number
  heatmapVisible: boolean
  heatmapMetric: HeatmapMetric
  onChangeHour: (hour: number) => void
  onToggleVisible: () => void
  onChangeMetric: (metric: HeatmapMetric) => void
}

export interface RouteMapProps {
  routes?: AnalyzedRoute[]
  selectedRouteId?: string | null
  onSelectRoute?: (routeId: string) => void
  origin?: LocationPoint | null
  destination?: LocationPoint | null
  corridorHeatmap?: CorridorHeatmap | null
  forecastHour?: number
  heatmapVisible?: boolean
  heatmapMetric?: HeatmapMetric
  focusedCheckpoint?: RouteCheckpoint | null
}

