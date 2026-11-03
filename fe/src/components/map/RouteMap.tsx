import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

import {
  CHECKPOINTS_LAYER_ID,
  DEFAULT_US_CENTER,
  DEFAULT_US_ZOOM,
  HEATMAP_LAYER_ID,
  INACTIVE_ROUTES_LINE_ID,
} from '../../constants/map'
import { MAP_STYLES, type MapStyleKey } from '../../constants/risk'
import type { RouteMapProps } from '../../interfaces'
import {
  applyHeatmapFrame,
  buildHeatmapSkeleton,
  buildRouteSignature,
  calibrateHeatmapRadius,
  emptyFeatureCollection,
  ensureMapLayers,
  fitMapToRoutes,
  focusMapCheckpoint,
  openCheckpointPopup,
  syncMapFeatures,
} from '../../utils/mapUtils'
import { RiskLegend } from './RiskLegend'
import './RouteMap.css'

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
  const heatmapSkeletonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    emptyFeatureCollection() as GeoJSON.FeatureCollection<GeoJSON.Point>,
  )

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

  useEffect(() => {
    heatmapSkeletonRef.current = buildHeatmapSkeleton(corridorHeatmap)
  }, [corridorHeatmap])

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

    map.on('style.load', () => {
      ensureMapLayers(map)
      setStyleReadyVersion((v) => v + 1)
    })

    map.on('mouseenter', INACTIVE_ROUTES_LINE_ID, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', INACTIVE_ROUTES_LINE_ID, () => {
      map.getCanvas().style.cursor = ''
    })
    map.on('click', INACTIVE_ROUTES_LINE_ID, (event) => {
      const routeId = event.features?.[0]?.properties?.id
      if (typeof routeId === 'string' && onSelectRouteRef.current) {
        onSelectRouteRef.current(routeId)
      }
    })

    map.on('mouseenter', CHECKPOINTS_LAYER_ID, (event) => {
      map.getCanvas().style.cursor = 'pointer'
      openCheckpointPopup(map, popup, event)
    })
    map.on('mouseleave', CHECKPOINTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
    })
    map.on('click', CHECKPOINTS_LAYER_ID, (event) => {
      openCheckpointPopup(map, popup, event)
    })

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
  }, [isTokenValid, mapboxToken])

  // Sync routes, checkpoints, and origin/destination markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) {
      return
    }
    ensureMapLayers(map)
    syncMapFeatures(map, routes, activeRouteId, origin, destination)
  }, [routes, activeRouteId, origin, destination, styleReadyVersion])

  // Fit camera bounds automatically whenever a new set of routes is loaded
  useEffect(() => {
    const map = mapRef.current
    if (!map || routes.length === 0) {
      return
    }
    const routeSignature = buildRouteSignature(routes, origin, destination)
    if (routeSignature === lastFittedKeyRef.current) {
      return
    }
    lastFittedKeyRef.current = routeSignature
    fitMapToRoutes(map, popupRef.current, routes)
  }, [routes, origin, destination])

  // Focus & open popup when user clicks a checkpoint row in the sidebar
  useEffect(() => {
    const map = mapRef.current
    const popup = popupRef.current
    if (!map || !popup || !focusedCheckpoint) {
      return
    }
    focusMapCheckpoint(map, popup, focusedCheckpoint)
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

    calibrateHeatmapRadius(map, corridorHeatmap)

    if (rafHeatmapIdRef.current !== null) {
      cancelAnimationFrame(rafHeatmapIdRef.current)
    }

    rafHeatmapIdRef.current = requestAnimationFrame(() => {
      applyHeatmapFrame(
        map,
        corridorHeatmap,
        heatmapSkeletonRef.current,
        forecastHour,
        heatmapMetric,
      )
    })
  }, [corridorHeatmap, forecastHour, heatmapMetric, styleReadyVersion])

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
                  onClick={() => {
                    if (key !== styleKey) {
                      setStyleKey(key)
                      mapRef.current?.setStyle(MAP_STYLES[key].url)
                    }
                  }}
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
