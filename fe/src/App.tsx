import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

import {
  extractApiErrorMessage,
  fetchBackendHealth,
  planWeatherAwareRoutes,
} from './api/routingApi'
import { ForecastSlider } from './components/heatmap/ForecastSlider'
import { RouteMap } from './components/map/RouteMap'
import { CheckpointList } from './components/sidebar/CheckpointList'
import { RouteCard } from './components/sidebar/RouteCard'
import { TripForm } from './components/sidebar/TripForm'
import type {
  HeatmapMetric,
  LocationValue,
  RouteCheckpoint,
  RoutePlanResponse,
  SamplingIntervalMiles,
} from './interfaces'
import { toLocalDateTimeInputValue } from './utils/format'
import './App.css'

function App() {
  const [origin, setOrigin] = useState<LocationValue>({ text: '', point: null })
  const [destination, setDestination] = useState<LocationValue>({ text: '', point: null })
  const [departureLocal, setDepartureLocal] = useState<string>(() =>
    toLocalDateTimeInputValue(),
  )
  const [loadWeightLb, setLoadWeightLb] = useState<string>('35000')
  const [intervalMiles, setIntervalMiles] = useState<SamplingIntervalMiles>(25)

  const [planResult, setPlanResult] = useState<RoutePlanResponse | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [focusedCheckpoint, setFocusedCheckpoint] = useState<RouteCheckpoint | null>(null)

  const [forecastHour, setForecastHour] = useState<number>(0)
  const [heatmapVisible, setHeatmapVisible] = useState<boolean>(true)
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>('risk')

  const [loading, setLoading] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true)

  const activeRequestRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetchBackendHealth()
      .then((res) => {
        setApiOnline(res.status === 'ok')
      })
      .catch(() => {
        setApiOnline(false)
      })
  }, [])

  const runRoutePlan = useCallback(
    async (
      targetInterval: SamplingIntervalMiles,
      preserveSelection: boolean,
    ) => {
      if (!origin.text.trim() || !destination.text.trim()) {
        return
      }

      activeRequestRef.current?.abort()
      const controller = new AbortController()
      activeRequestRef.current = controller

      setLoading(true)
      setErrorMessage(null)

      const parsedDeparture = departureLocal ? new Date(departureLocal) : null
      const departureIso =
        parsedDeparture && !Number.isNaN(parsedDeparture.getTime())
          ? parsedDeparture.toISOString()
          : null

      try {
        const response = await planWeatherAwareRoutes(
          {
            origin: origin.point ?? origin.text.trim(),
            destination: destination.point ?? destination.text.trim(),
            departure_time: departureIso,
            load_weight_lb: Math.max(0, Number(loadWeightLb) || 0),
            interval_miles: targetInterval,
          },
          controller.signal,
        )

        setPlanResult(response)
        setApiOnline(true)
        setOrigin({ text: response.origin.label, point: response.origin })
        setDestination({ text: response.destination.label, point: response.destination })
        setFocusedCheckpoint(null)

        if (!preserveSelection) {
          setSelectedRouteId(
            response.recommended_route_id ?? response.routes[0]?.id ?? null,
          )
          setForecastHour(0)
        } else {
          setSelectedRouteId((prev) =>
            prev && response.routes.some((r) => r.id === prev)
              ? prev
              : (response.recommended_route_id ?? response.routes[0]?.id ?? null),
          )
        }
      } catch (err) {
        if (axios.isCancel(err)) {
          return
        }
        setErrorMessage(extractApiErrorMessage(err))
      } finally {
        if (activeRequestRef.current === controller) {
          setLoading(false)
        }
      }
    },
    [origin, destination, departureLocal, loadWeightLb],
  )

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void runRoutePlan(intervalMiles, false)
  }

  const handleIntervalChange = (nextInterval: SamplingIntervalMiles) => {
    setIntervalMiles(nextInterval)
    if (planResult && origin.text.trim() && destination.text.trim()) {
      void runRoutePlan(nextInterval, true)
    }
  }

  const handleSwapLocations = () => {
    setOrigin(destination)
    setDestination(origin)
  }

  const handleSelectRoute = useCallback((routeId: string) => {
    setSelectedRouteId(routeId)
    setFocusedCheckpoint(null)
  }, [])

  const handleFocusCheckpoint = useCallback((checkpoint: RouteCheckpoint) => {
    setFocusedCheckpoint(checkpoint)
    if (window.innerWidth <= 900) {
      setSidebarOpen(false)
    }
  }, [])

  const selectedRoute = useMemo(() => {
    if (!planResult) {
      return null
    }
    return (
      planResult.routes.find((r) => r.id === selectedRouteId) ??
      planResult.routes[0] ??
      null
    )
  }, [planResult, selectedRouteId])

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
        <header className="sidebar-header">
          <div className="sidebar-header-main">
            <div className="brand-row">
              <span className="brand-dot" />
              <span className="brand-name">Spotter</span>
              <span
                className={`api-status-pill ${apiOnline === true ? 'online' : apiOnline === false ? 'offline' : ''
                  }`}
              >
                {apiOnline === true
                  ? 'API Ready'
                  : apiOnline === false
                    ? 'API Offline'
                    : 'Checking…'}
              </span>
            </div>
            <div className="sidebar-title-row">
              <h1 className="sidebar-title">Weather-Aware Truck Routing</h1>
              <button
                type="button"
                className="sidebar-close-mobile-btn"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close trip planner panel"
              >
                ✕ Map
              </button>
            </div>
          </div>
        </header>

        <div className="sidebar-scroll-body">
          <TripForm
            origin={origin}
            destination={destination}
            departureLocal={departureLocal}
            loadWeightLb={loadWeightLb}
            intervalMiles={intervalMiles}
            loading={loading}
            onChangeOrigin={setOrigin}
            onChangeDestination={setDestination}
            onSwapLocations={handleSwapLocations}
            onChangeDeparture={setDepartureLocal}
            onChangeLoadWeight={setLoadWeightLb}
            onChangeInterval={handleIntervalChange}
            onSubmit={handleSubmit}
          />

          {errorMessage && (
            <div className="alert-box error" role="alert">
              <strong>Unable to plan route:</strong> {errorMessage}
            </div>
          )}

          {planResult && (
            <section className="results-section">
              <div
                className={`recommendation-callout ${planResult.has_no_travel_advisory ? 'advisory' : 'safe'
                  }`}
              >
                <div className="callout-label">
                  {planResult.has_no_travel_advisory
                    ? '⚠ Extreme Weather — No Travel Advisory'
                    : '✓ Route Recommendation'}
                </div>
                <p className="callout-text">{planResult.recommendation_reason}</p>
              </div>

              <div className="routes-list-header">
                <h2 className="section-subtitle">
                  Route Options ({planResult.routes.length})
                </h2>
                <span className="section-caption">
                  Load: {planResult.load_weight_lb.toLocaleString()} lb
                </span>
              </div>

              <div className="routes-list">
                {planResult.routes.map((route) => (
                  <RouteCard
                    key={route.id}
                    route={route}
                    isSelected={selectedRoute?.id === route.id}
                    onSelect={handleSelectRoute}
                  />
                ))}
              </div>

              {selectedRoute && (
                <CheckpointList
                  routeName={selectedRoute.name}
                  intervalMiles={planResult.interval_miles}
                  checkpoints={selectedRoute.checkpoints}
                  focusedCheckpointIndex={focusedCheckpoint?.index ?? null}
                  onFocusCheckpoint={handleFocusCheckpoint}
                />
              )}
            </section>
          )}
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="sidebar-mobile-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <main className="app-map-stage">
        <button
          type="button"
          className="sidebar-toggle-fab"
          onClick={() => setSidebarOpen((open) => !open)}
          title={sidebarOpen ? 'Collapse panel' : 'Expand panel'}
        >
          {sidebarOpen ? '◀ Hide Panel' : '▶ Trip Planner'}
        </button>

        {loading && (
          <div className="map-loading-banner" role="status">
            <span className="map-loading-spinner" />
            <span>Sampling truck routes, ETA checkpoints &amp; 48h weather corridor…</span>
          </div>
        )}

        <RouteMap
          routes={planResult?.routes}
          selectedRouteId={selectedRoute?.id ?? null}
          onSelectRoute={handleSelectRoute}
          origin={planResult?.origin ?? origin.point}
          destination={planResult?.destination ?? destination.point}
          corridorHeatmap={planResult?.corridor_heatmap ?? null}
          forecastHour={forecastHour}
          heatmapVisible={heatmapVisible}
          heatmapMetric={heatmapMetric}
          focusedCheckpoint={focusedCheckpoint}
        />

        {planResult?.corridor_heatmap && (
          <ForecastSlider
            corridorHeatmap={planResult.corridor_heatmap}
            forecastHour={forecastHour}
            heatmapVisible={heatmapVisible}
            heatmapMetric={heatmapMetric}
            onChangeHour={setForecastHour}
            onToggleVisible={() => setHeatmapVisible((v) => !v)}
            onChangeMetric={setHeatmapMetric}
          />
        )}
      </main>
    </div>
  )
}

export default App
