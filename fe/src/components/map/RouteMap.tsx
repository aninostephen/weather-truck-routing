import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

import {
  MAP_STYLES,
  RISK_COLORS,
  type MapStyleKey,
} from '../../constants/risk'
import type {
  AnalyzedRoute,
  HeatmapMetric,
  RiskLevel,
  RouteMapProps,
} from '../../interfaces'
import { RiskLegend } from './RiskLegend'
import './RouteMap.css'

const DEFAULT_US_CENTER: [number, number] = [-98.5795, 39.8283]
const DEFAULT_US_ZOOM = 4

const HEATMAP_SOURCE_ID = 'corridor-heatmap-source'
const HEATMAP_LAYER_ID = 'corridor-heatmap-layer'

const INACTIVE_ROUTES_SOURCE_ID = 'routes-inactive-source'
const INACTIVE_ROUTES_CASING_ID = 'routes-inactive-casing'
const INACTIVE_ROUTES_LINE_ID = 'routes-inactive-line'

const SELECTED_ROUTE_SOURCE_ID = 'route-selected-source'
const SELECTED_ROUTE_GLOW_ID = 'route-selected-glow'
const SELECTED_ROUTE_CASING_ID = 'route-selected-casing'
const SELECTED_ROUTE_LINE_ID = 'route-selected-line'

const CHECKPOINTS_SOURCE_ID = 'checkpoints-source'
const CHECKPOINTS_LAYER_ID = 'checkpoints-layer'

const ENDPOINTS_SOURCE_ID = 'endpoints-source'
const ENDPOINTS_CIRCLE_ID = 'endpoints-circle'
const ENDPOINTS_LABEL_ID = 'endpoints-label'

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
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

function getMetricWeight(
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

function buildCorridorRadiusExpression(
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

function buildPopupElement(props: Record<string, unknown>): HTMLElement {
  const container = document.createElement('div')

  const header = document.createElement('div')
  header.className = 'cp-popup-header'

  const mileEl = document.createElement('span')
  mileEl.className = 'cp-popup-mile'
  mileEl.textContent = `Mile ${Number(props.distance_miles ?? 0).toFixed(1)}`

  const riskLevel = (String(props.risk_level || 'Low') as RiskLevel)
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

export function RouteMap({
  routes = [],
  selectedRouteId = null,
  onSelectRoute,
  origin = null,
  destination = null,
  corridorHeatmap = null,
  forecastHour = 0,
  heatmapVisible = true,
  heatmapMetric = 'risk',
  focusedCheckpoint = null,
}: RouteMapProps) {
  const mapboxToken = (
    (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined) ?? ''
  ).trim()
  const isTokenValid = Boolean(
    mapboxToken && mapboxToken !== 'your_mapbox_access_token_here',
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const popupRef = useRef<mapboxgl.Popup | null>(null)
  const onSelectRouteRef = useRef(onSelectRoute)
  const rafHeatmapIdRef = useRef<number | null>(null)
  const lastFittedKeyRef = useRef<string>('')

  const [styleKey, setStyleKey] = useState<MapStyleKey>('night')
  const [styleReadyVersion, setStyleReadyVersion] = useState(0)

  useEffect(() => {
    onSelectRouteRef.current = onSelectRoute
  }, [onSelectRoute])

  const activeRouteId = useMemo(() => {
    if (selectedRouteId && routes.some((r) => r.id === selectedRouteId)) {
      return selectedRouteId
    }
    return routes.find((r) => r.is_recommended)?.id ?? routes[0]?.id ?? null
  }, [routes, selectedRouteId])

  // Pre-build reusable heatmap FeatureCollection skeleton when corridor points change
  const heatmapSkeletonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    emptyFeatureCollection() as GeoJSON.FeatureCollection<GeoJSON.Point>,
  )

  useEffect(() => {
    if (!corridorHeatmap?.points?.length) {
      heatmapSkeletonRef.current = { type: 'FeatureCollection', features: [] }
      return
    }
    heatmapSkeletonRef.current = {
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
  }, [corridorHeatmap])

  const ensureLayers = useCallback((map: mapboxgl.Map) => {
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
  }, [])

  // Initialize Mapbox GL JS instance once
  useEffect(() => {
    if (!isTokenValid || !containerRef.current) {
      return
    }

    mapboxgl.accessToken = mapboxToken

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLES.night.url,
      center: DEFAULT_US_CENTER,
      zoom: DEFAULT_US_ZOOM,
      attributionControl: true,
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right')
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 110, unit: 'imperial' }), 'bottom-left')

    const popup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'checkpoint-map-popup',
      maxWidth: '280px',
      offset: 12,
    })
    popupRef.current = popup

    const handleStyleLoad = () => {
      ensureLayers(map)
      setStyleReadyVersion((v) => v + 1)
    }

    map.on('style.load', handleStyleLoad)

    // Interactive cursor + route selection for alternative routes
    map.on('mouseenter', INACTIVE_ROUTES_LINE_ID, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', INACTIVE_ROUTES_LINE_ID, () => {
      map.getCanvas().style.cursor = ''
    })
    map.on('click', INACTIVE_ROUTES_LINE_ID, (event) => {
      const feature = event.features?.[0]
      const routeId = feature?.properties?.id
      if (typeof routeId === 'string' && onSelectRouteRef.current) {
        onSelectRouteRef.current(routeId)
      }
    })

    // Interactive checkpoint hover & click popup
    const showCheckpointPopup = (event: mapboxgl.MapLayerMouseEvent) => {
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

    map.on('mouseenter', CHECKPOINTS_LAYER_ID, (event) => {
      map.getCanvas().style.cursor = 'pointer'
      showCheckpointPopup(event)
    })
    map.on('mouseleave', CHECKPOINTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
    })
    map.on('click', CHECKPOINTS_LAYER_ID, showCheckpointPopup)

    // Keep WebGL canvas sized accurately when parent flex/grid panes resize
    const resizeObserver = new ResizeObserver(() => {
      map.resize()
    })
    resizeObserver.observe(containerRef.current)

    mapRef.current = map

    return () => {
      if (rafHeatmapIdRef.current !== null) {
        cancelAnimationFrame(rafHeatmapIdRef.current)
      }
      resizeObserver.disconnect()
      popup.remove()
      map.remove()
      mapRef.current = null
      popupRef.current = null
    }
  }, [isTokenValid, mapboxToken, ensureLayers])

  // Sync routes, checkpoints, and origin/destination markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) {
      return
    }
    ensureLayers(map)

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
  }, [routes, activeRouteId, origin, destination, styleReadyVersion, ensureLayers])

  // Fit camera bounds automatically whenever a new set of routes is loaded
  useEffect(() => {
    const map = mapRef.current
    if (!map || routes.length === 0) {
      return
    }

    const endpointKey = `${origin?.lat ?? ''},${origin?.lng ?? ''}->${destination?.lat ?? ''},${destination?.lng ?? ''}`
    const routeSignature = `${endpointKey}|${routes.map((r) => `${r.id}:${r.distance_miles}`).join('|')}`
    if (routeSignature === lastFittedKeyRef.current) {
      return
    }
    lastFittedKeyRef.current = routeSignature

    const bounds = new mapboxgl.LngLatBounds()
    let hasPoints = false
    for (const route of routes) {
      for (const coord of route.geometry.coordinates) {
        bounds.extend(coord)
        hasPoints = true
      }
    }

    if (hasPoints) {
      popupRef.current?.remove()
      map.fitBounds(bounds, {
        padding: { top: 72, bottom: 130, left: 72, right: 72 },
        maxZoom: 11,
        duration: 850,
      })
    }
  }, [routes, origin, destination])

  // Focus & open popup when user clicks a checkpoint row in the sidebar
  useEffect(() => {
    const map = mapRef.current
    const popup = popupRef.current
    if (!map || !popup || !focusedCheckpoint) {
      return
    }

    const coords: [number, number] = [focusedCheckpoint.lng, focusedCheckpoint.lat]
    map.easeTo({
      center: coords,
      zoom: Math.max(map.getZoom(), 7.2),
      duration: 550,
    })

    popup
      .setLngLat(coords)
      .setDOMContent(
        buildPopupElement({
          distance_miles: focusedCheckpoint.distance_miles,
          risk_level: focusedCheckpoint.risk_level,
          eta: focusedCheckpoint.eta,
          wind_mph: focusedCheckpoint.weather.wind_mph,
          rain_in_hr: focusedCheckpoint.weather.rain_in_hr,
          snow_in_hr: focusedCheckpoint.weather.snow_in_hr,
          load_rule_triggered: focusedCheckpoint.load_rule_triggered,
        }),
      )
      .addTo(map)
  }, [focusedCheckpoint])

  // Toggle heatmap visibility smoothly without tearing down the WebGL layer
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded() || !map.getLayer(HEATMAP_LAYER_ID)) {
      return
    }
    map.setLayoutProperty(
      HEATMAP_LAYER_ID,
      'visibility',
      heatmapVisible ? 'visible' : 'none',
    )
  }, [heatmapVisible, styleReadyVersion])

  // 60-FPS rAF corridor heatmap frame update when scrubbing 0-48h slider or metric
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) {
      return
    }

    // Calibrate physical corridor cell radius to corridor latitude & grid spacing
    if (corridorHeatmap?.points?.length) {
      const lats = corridorHeatmap.points.map((p) => p.lat)
      const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
      const spacing = corridorHeatmap.grid_spacing_miles ?? 12
      if (map.getLayer(HEATMAP_LAYER_ID)) {
        map.setPaintProperty(
          HEATMAP_LAYER_ID,
          'circle-radius',
          buildCorridorRadiusExpression(spacing, midLat),
        )
      }
    }

    if (rafHeatmapIdRef.current !== null) {
      cancelAnimationFrame(rafHeatmapIdRef.current)
    }

    rafHeatmapIdRef.current = requestAnimationFrame(() => {
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
      const skeleton = heatmapSkeletonRef.current

      for (let i = 0; i < skeleton.features.length; i += 1) {
        const tuple = frame.values[i]
        skeleton.features[i].properties = {
          weight: tuple ? getMetricWeight(tuple, heatmapMetric) : 0,
        }
      }

      heatmapSrc.setData(skeleton)
    })
  }, [corridorHeatmap, forecastHour, heatmapMetric, styleReadyVersion])

  const handleStyleSwitch = (nextKey: MapStyleKey) => {
    if (nextKey === styleKey) {
      return
    }
    setStyleKey(nextKey)
    mapRef.current?.setStyle(MAP_STYLES[nextKey].url)
  }

  return (
    <div className="route-map-wrapper">
      <div ref={containerRef} className="route-map-canvas" />

      {!isTokenValid ? (
        <div className="map-token-notice">
          <div className="map-token-card">
            <span className="map-token-badge">Mapbox Setup Required</span>
            <h2>Add Your Mapbox Access Token</h2>
            <p>
              Mapbox GL JS is wired up and ready. Paste your public token (<code>pk.*</code>)
              into <code>fe/.env</code> and restart <code>npm run dev</code>:
            </p>
            <code className="map-token-code">
              VITE_MAPBOX_ACCESS_TOKEN=pk.eyJ1Ijoi...
            </code>
          </div>
        </div>
      ) : (
        <>
          <div className="map-floating-controls">
            <div className="map-pill-group" role="group" aria-label="Map style">
              {(['night', 'day'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`map-pill-btn ${styleKey === key ? 'active' : ''}`}
                  onClick={() => handleStyleSwitch(key)}
                >
                  {MAP_STYLES[key].label}
                </button>
              ))}
            </div>
          </div>

          <RiskLegend heatmapMetric={heatmapMetric} />
        </>
      )}
    </div>
  )
}

