import mapboxgl from 'mapbox-gl'

import {
  CHECKPOINTS_LAYER_ID,
  CHECKPOINTS_SOURCE_ID,
  ENDPOINTS_CIRCLE_ID,
  ENDPOINTS_LABEL_ID,
  ENDPOINTS_SOURCE_ID,
  HEATMAP_LAYER_ID,
  HEATMAP_SOURCE_ID,
  INACTIVE_ROUTES_CASING_ID,
  INACTIVE_ROUTES_LINE_ID,
  INACTIVE_ROUTES_SOURCE_ID,
  SELECTED_ROUTE_CASING_ID,
  SELECTED_ROUTE_GLOW_ID,
  SELECTED_ROUTE_LINE_ID,
  SELECTED_ROUTE_SOURCE_ID,
} from '../constants/map'
import { RISK_COLORS } from '../constants/risk'
import type {
  AnalyzedRoute,
  CorridorHeatmap,
  HeatmapMetric,
  LocationPoint,
  RiskLevel,
  RouteCheckpoint,
} from '../interfaces'

export function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

export function buildHeatmapSkeleton(
  corridorHeatmap: CorridorHeatmap | null,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!corridorHeatmap?.points?.length) {
    return { type: 'FeatureCollection', features: [] }
  }
  return {
    type: 'FeatureCollection',
    features: corridorHeatmap.points.map((pt) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [pt.lng, pt.lat],
      },
      properties: {
        weight: 0,
      },
    })),
  }
}

function mapPiecewiseThreshold(
  val: number,
  tMod: number,
  tHigh: number,
  tSev: number,
  tNoTravel: number,
): number {
  if (val > tNoTravel) {
    return 1.0
  }
  if (val >= tSev) {
    return 0.75 + 0.24 * Math.min(1, (val - tSev) / Math.max(0.01, tNoTravel - tSev))
  }
  if (val >= tHigh) {
    return 0.5 + 0.24 * ((val - tHigh) / Math.max(0.01, tSev - tHigh))
  }
  if (val >= tMod) {
    return 0.25 + 0.24 * ((val - tMod) / Math.max(0.01, tHigh - tMod))
  }
  return 0.24 * Math.min(1, Math.max(0, val / Math.max(0.01, tMod)))
}

export function getMetricWeight(
  tuple: [number, number, number, number, number],
  metric: HeatmapMetric,
): number {
  switch (metric) {
    case 'wind':
      return tuple[2] >= 55
        ? 1.0
        : mapPiecewiseThreshold(tuple[2], 25, 35, 45, 55)
    case 'rain':
      return mapPiecewiseThreshold(tuple[3], 0.1, 0.25, 0.5, 1.0)
    case 'snow':
      return mapPiecewiseThreshold(tuple[4], 0.5, 1.0, 2.0, 3.0)
    case 'risk':
    default:
      return Math.min(1, Math.max(0, tuple[0]))
  }
}

export function buildCorridorRadiusExpression(
  spacingMiles: number,
  midLatDeg: number,
): mapboxgl.ExpressionSpecification {
  const cosLat = Math.max(0.18, Math.cos((midLatDeg * Math.PI) / 180))
  const radiusAtZoom = (zoom: number) => {
    const pxPerMile = (512 * Math.pow(2, zoom)) / (24901.46 * cosLat)
    return Math.round(Math.max(10, Math.min(150, spacingMiles * pxPerMile * 1.55)) * 10) / 10
  }
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    2,
    radiusAtZoom(2),
    5,
    radiusAtZoom(5),
    8,
    radiusAtZoom(8),
    11,
    radiusAtZoom(11),
  ]
}

export function buildPopupElement(props: Record<string, unknown>): HTMLElement {
  const container = document.createElement('div')

  const header = document.createElement('div')
  header.className = 'cp-popup-header'

  const mileEl = document.createElement('span')
  mileEl.className = 'cp-popup-mile'
  mileEl.textContent = `Mile ${Number(props.distance_miles ?? 0).toFixed(1)}`

  const riskLevel = String(props.risk_level || 'Low') as RiskLevel
  const badge = document.createElement('span')
  badge.className = 'cp-popup-badge'
  badge.style.backgroundColor = RISK_COLORS[riskLevel] ?? RISK_COLORS.Low
  if (riskLevel === 'Severe' || riskLevel === 'No Travel') {
    badge.style.color = '#ffffff'
  }
  badge.textContent = riskLevel

  header.append(mileEl, badge)
  container.appendChild(header)

  const etaEl = document.createElement('div')
  etaEl.className = 'cp-popup-eta'
  const etaDate = props.eta ? new Date(String(props.eta)) : null
  etaEl.textContent =
    etaDate && !Number.isNaN(etaDate.getTime())
      ? `ETA: ${etaDate.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}`
      : 'ETA: —'
  container.appendChild(etaEl)

  const grid = document.createElement('div')
  grid.className = 'cp-popup-grid'

  const metrics: [string, string][] = [
    ['Wind', `${Number(props.wind_mph ?? 0).toFixed(1)} mph`],
    ['Rain', `${Number(props.rain_in_hr ?? 0).toFixed(2)} in/h`],
    ['Snow', `${Number(props.snow_in_hr ?? 0).toFixed(2)} in/h`],
  ]

  for (const [label, value] of metrics) {
    const cell = document.createElement('div')
    cell.className = 'cp-popup-metric'

    const labelEl = document.createElement('span')
    labelEl.className = 'cp-popup-metric-label'
    labelEl.textContent = label

    const valEl = document.createElement('span')
    valEl.className = 'cp-popup-metric-val'
    valEl.textContent = value

    cell.append(labelEl, valEl)
    grid.appendChild(cell)
  }
  container.appendChild(grid)

  if (props.load_rule_triggered === true || props.load_rule_triggered === 'true') {
    const note = document.createElement('div')
    note.className = 'cp-popup-escalation'
    note.textContent = 'Escalated by heavy load wind rule'
    container.appendChild(note)
  }

  return container
}

export function openCheckpointPopup(
  map: mapboxgl.Map,
  popup: mapboxgl.Popup,
  event: mapboxgl.MapLayerMouseEvent,
): void {
  const feature = event.features?.[0]
  if (!feature || feature.geometry.type !== 'Point' || !feature.properties) {
    return
  }
  const coords = feature.geometry.coordinates.slice() as [number, number]
  popup
    .setLngLat(coords)
    .setDOMContent(buildPopupElement(feature.properties as Record<string, unknown>))
    .addTo(map)
}

export function ensureMapLayers(map: mapboxgl.Map): void {
  if (!map.getSource(HEATMAP_SOURCE_ID)) {
    map.addSource(HEATMAP_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    })
  }

  if (!map.getLayer(HEATMAP_LAYER_ID)) {
    map.addLayer({
      id: HEATMAP_LAYER_ID,
      type: 'circle',
      source: HEATMAP_SOURCE_ID,
      paint: {
        'circle-radius': buildCorridorRadiusExpression(12, 40),
        'circle-blur': 0.88,
        'circle-color': [
          'step',
          ['coalesce', ['get', 'weight'], 0],
          RISK_COLORS.Low,
          0.25,
          RISK_COLORS.Moderate,
          0.5,
          RISK_COLORS.High,
          0.75,
          RISK_COLORS.Severe,
          1.0,
          RISK_COLORS['No Travel'],
        ],
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'weight'], 0],
          0,
          0.16,
          0.24,
          0.22,
          0.25,
          0.3,
          0.5,
          0.38,
          0.75,
          0.46,
          1.0,
          0.56,
        ],
      },
    })
  }

  if (!map.getSource(INACTIVE_ROUTES_SOURCE_ID)) {
    map.addSource(INACTIVE_ROUTES_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    })
  }

  if (!map.getLayer(INACTIVE_ROUTES_CASING_ID)) {
    map.addLayer({
      id: INACTIVE_ROUTES_CASING_ID,
      type: 'line',
      source: INACTIVE_ROUTES_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#0f172a',
        'line-width': 8,
        'line-opacity': 0.75,
      },
    })
  }

  if (!map.getLayer(INACTIVE_ROUTES_LINE_ID)) {
    map.addLayer({
      id: INACTIVE_ROUTES_LINE_ID,
      type: 'line',
      source: INACTIVE_ROUTES_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#64748b',
        'line-width': 4.5,
        'line-opacity': 0.82,
      },
    })
  }

  if (!map.getSource(SELECTED_ROUTE_SOURCE_ID)) {
    map.addSource(SELECTED_ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    })
  }

  if (!map.getLayer(SELECTED_ROUTE_GLOW_ID)) {
    map.addLayer({
      id: SELECTED_ROUTE_GLOW_ID,
      type: 'line',
      source: SELECTED_ROUTE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['get', 'is_recommended'], false],
          '#10b981',
          '#38bdf8',
        ],
        'line-width': 14,
        'line-opacity': 0.25,
        'line-blur': 4,
      },
    })
  }

  if (!map.getLayer(SELECTED_ROUTE_CASING_ID)) {
    map.addLayer({
      id: SELECTED_ROUTE_CASING_ID,
      type: 'line',
      source: SELECTED_ROUTE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#020617',
        'line-width': 8.5,
      },
    })
  }

  if (!map.getLayer(SELECTED_ROUTE_LINE_ID)) {
    map.addLayer({
      id: SELECTED_ROUTE_LINE_ID,
      type: 'line',
      source: SELECTED_ROUTE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['get', 'is_recommended'], false],
          '#10b981',
          '#38bdf8',
        ],
        'line-width': 5.5,
      },
    })
  }

  if (!map.getSource(CHECKPOINTS_SOURCE_ID)) {
    map.addSource(CHECKPOINTS_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    })
  }

  if (!map.getLayer(CHECKPOINTS_LAYER_ID)) {
    map.addLayer({
      id: CHECKPOINTS_LAYER_ID,
      type: 'circle',
      source: CHECKPOINTS_SOURCE_ID,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          ['case', ['>=', ['get', 'risk_score'], 3], 6, 4.2],
          8,
          ['case', ['>=', ['get', 'risk_score'], 3], 8.5, 6.2],
          12,
          ['case', ['>=', ['get', 'risk_score'], 3], 10.5, 8],
        ],
        'circle-color': [
          'match',
          ['get', 'risk_level'],
          'Low',
          RISK_COLORS.Low,
          'Moderate',
          RISK_COLORS.Moderate,
          'High',
          RISK_COLORS.High,
          'Severe',
          RISK_COLORS.Severe,
          'No Travel',
          RISK_COLORS['No Travel'],
          RISK_COLORS.Low,
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.75,
      },
    })
  }

  if (!map.getSource(ENDPOINTS_SOURCE_ID)) {
    map.addSource(ENDPOINTS_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    })
  }

  if (!map.getLayer(ENDPOINTS_CIRCLE_ID)) {
    map.addLayer({
      id: ENDPOINTS_CIRCLE_ID,
      type: 'circle',
      source: ENDPOINTS_SOURCE_ID,
      paint: {
        'circle-radius': 9,
        'circle-color': [
          'match',
          ['get', 'kind'],
          'origin',
          '#22c55e',
          '#38bdf8',
        ],
        'circle-stroke-color': '#020617',
        'circle-stroke-width': 2.5,
      },
    })
  }

  if (!map.getLayer(ENDPOINTS_LABEL_ID)) {
    map.addLayer({
      id: ENDPOINTS_LABEL_ID,
      type: 'symbol',
      source: ENDPOINTS_SOURCE_ID,
      layout: {
        'text-field': ['get', 'shortLabel'],
        'text-size': 11,
        'text-offset': [0, -1.6],
        'text-anchor': 'bottom',
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': '#020617',
        'text-halo-width': 1.5,
      },
    })
  }
}

export function syncMapFeatures(
  map: mapboxgl.Map,
  routes: AnalyzedRoute[],
  activeRouteId: string | null,
  origin: LocationPoint | null,
  destination: LocationPoint | null,
): void {
  const inactiveFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = []
  const selectedFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = []
  let activeRoute: AnalyzedRoute | undefined

  for (const route of routes) {
    const lineFeature: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      geometry: route.geometry,
      properties: {
        id: route.id,
        name: route.name,
        is_recommended: route.is_recommended,
      },
    }
    if (route.id === activeRouteId) {
      activeRoute = route
      selectedFeatures.push(lineFeature)
    } else {
      inactiveFeatures.push(lineFeature)
    }
  }

  const inactiveSrc = map.getSource(INACTIVE_ROUTES_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  inactiveSrc?.setData({ type: 'FeatureCollection', features: inactiveFeatures })

  const selectedSrc = map.getSource(SELECTED_ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  selectedSrc?.setData({ type: 'FeatureCollection', features: selectedFeatures })

  const checkpointFeatures: GeoJSON.Feature<GeoJSON.Point>[] = (
    activeRoute?.checkpoints ?? []
  ).map((cp) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [cp.lng, cp.lat],
    },
    properties: {
      index: cp.index,
      distance_miles: cp.distance_miles,
      eta: cp.eta,
      risk_level: cp.risk_level,
      risk_score: cp.risk_score,
      wind_mph: cp.weather.wind_mph,
      rain_in_hr: cp.weather.rain_in_hr,
      snow_in_hr: cp.weather.snow_in_hr,
      load_rule_triggered: cp.load_rule_triggered,
    },
  }))

  const checkpointsSrc = map.getSource(CHECKPOINTS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  checkpointsSrc?.setData({ type: 'FeatureCollection', features: checkpointFeatures })

  const endpointFeatures: GeoJSON.Feature<GeoJSON.Point>[] = []
  if (origin) {
    endpointFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [origin.lng, origin.lat] },
      properties: { kind: 'origin', shortLabel: 'ORIGIN', label: origin.label },
    })
  }
  if (destination) {
    endpointFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [destination.lng, destination.lat] },
      properties: { kind: 'destination', shortLabel: 'DEST', label: destination.label },
    })
  }

  const endpointsSrc = map.getSource(ENDPOINTS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  endpointsSrc?.setData({ type: 'FeatureCollection', features: endpointFeatures })
}

export function buildRouteSignature(
  routes: AnalyzedRoute[],
  origin: LocationPoint | null,
  destination: LocationPoint | null,
): string {
  const endpointKey = `${origin?.lat ?? ''},${origin?.lng ?? ''}->${destination?.lat ?? ''},${destination?.lng ?? ''}`
  return `${endpointKey}|${routes.map((r) => `${r.id}:${r.distance_miles}`).join('|')}`
}

export function fitMapToRoutes(
  map: mapboxgl.Map,
  popup: mapboxgl.Popup | null,
  routes: AnalyzedRoute[],
): void {
  const bounds = new mapboxgl.LngLatBounds()
  let hasPoints = false

  for (const route of routes) {
    for (const coord of route.geometry.coordinates) {
      bounds.extend(coord)
      hasPoints = true
    }
  }

  if (hasPoints) {
    popup?.remove()
    map.fitBounds(bounds, {
      padding: { top: 72, bottom: 130, left: 72, right: 72 },
      maxZoom: 11,
      duration: 850,
    })
  }
}

export function focusMapCheckpoint(
  map: mapboxgl.Map,
  popup: mapboxgl.Popup,
  checkpoint: RouteCheckpoint,
): void {
  const coords: [number, number] = [checkpoint.lng, checkpoint.lat]
  map.easeTo({
    center: coords,
    zoom: Math.max(map.getZoom(), 7.2),
    duration: 550,
  })

  popup
    .setLngLat(coords)
    .setDOMContent(
      buildPopupElement({
        distance_miles: checkpoint.distance_miles,
        risk_level: checkpoint.risk_level,
        eta: checkpoint.eta,
        wind_mph: checkpoint.weather.wind_mph,
        rain_in_hr: checkpoint.weather.rain_in_hr,
        snow_in_hr: checkpoint.weather.snow_in_hr,
        load_rule_triggered: checkpoint.load_rule_triggered,
      }),
    )
    .addTo(map)
}

export function calibrateHeatmapRadius(
  map: mapboxgl.Map,
  corridorHeatmap: CorridorHeatmap | null,
): void {
  if (!corridorHeatmap?.points?.length || !map.getLayer(HEATMAP_LAYER_ID)) {
    return
  }
  const lats = corridorHeatmap.points.map((p) => p.lat)
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const spacing = corridorHeatmap.grid_spacing_miles ?? 12
  map.setPaintProperty(
    HEATMAP_LAYER_ID,
    'circle-radius',
    buildCorridorRadiusExpression(spacing, midLat),
  )
}

export function applyHeatmapFrame(
  map: mapboxgl.Map,
  corridorHeatmap: CorridorHeatmap | null,
  skeleton: GeoJSON.FeatureCollection<GeoJSON.Point>,
  forecastHour: number,
  heatmapMetric: HeatmapMetric,
): void {
  const heatmapSrc = map.getSource(HEATMAP_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  if (!heatmapSrc) {
    return
  }

  if (!corridorHeatmap || corridorHeatmap.hours.length === 0) {
    heatmapSrc.setData(emptyFeatureCollection())
    return
  }

  const clampedIdx = Math.max(
    0,
    Math.min(corridorHeatmap.hours.length - 1, Math.round(forecastHour)),
  )
  const frame = corridorHeatmap.hours[clampedIdx]

  for (let i = 0; i < skeleton.features.length; i += 1) {
    const tuple = frame.values[i]
    skeleton.features[i].properties = {
      weight: tuple ? getMetricWeight(tuple, heatmapMetric) : 0,
    }
  }

  heatmapSrc.setData(skeleton)
}

