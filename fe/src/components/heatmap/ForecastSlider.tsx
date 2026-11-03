import { useEffect, useMemo, useState } from 'react'

import {
  HEATMAP_METRIC_OPTIONS,
  RISK_COLORS,
  RISK_ORDER,
} from '../../constants/risk'
import type { ForecastSliderProps, RiskLevel } from '../../interfaces'
import { formatShortDateTime } from '../../utils/format'

export function ForecastSlider({
  corridorHeatmap,
  forecastHour,
  heatmapVisible,
  heatmapMetric,
  onChangeHour,
  onToggleVisible,
  onChangeMetric,
}: ForecastSliderProps) {
  const [playing, setPlaying] = useState(false)
  const maxHours = corridorHeatmap.max_hours || 48

  useEffect(() => {
    if (!playing) {
      return
    }
    const id = window.setInterval(() => {
      onChangeHour(forecastHour >= maxHours ? 0 : forecastHour + 1)
    }, 220)
    return () => window.clearInterval(id)
  }, [playing, forecastHour, maxHours, onChangeHour])

  const currentFrame = corridorHeatmap.hours[forecastHour]
  const timestampLabel = currentFrame
    ? formatShortDateTime(currentFrame.timestamp)
    : '—'

  const corridorPeak = useMemo(() => {
    let maxScore = 0
    let maxWind = 0
    let maxRain = 0
    let maxSnow = 0

    for (const tuple of currentFrame?.values ?? []) {
      if (tuple[1] > maxScore) maxScore = tuple[1]
      if (tuple[2] > maxWind) maxWind = tuple[2]
      if (tuple[3] > maxRain) maxRain = tuple[3]
      if (tuple[4] > maxSnow) maxSnow = tuple[4]
    }

    const peakLevel: RiskLevel =
      RISK_ORDER[Math.min(RISK_ORDER.length - 1, Math.max(0, Math.round(maxScore)))] ??
      'Low'

    return {
      peakLevel,
      maxWind,
      maxRain,
      maxSnow,
    }
  }, [currentFrame])

  return (
    <div className="forecast-slider-card" aria-label="Corridor 0 to 48 hour forecast slider">
      <div className="forecast-slider-top">
        <div className="forecast-title-group">
          <span className="forecast-eyebrow">Trip Corridor Weather Heatmap</span>
          <span className="forecast-timestamp">
            <strong>+{forecastHour}h</strong> • {timestampLabel}
          </span>
        </div>

        <div className="forecast-controls-right">
          <div className="forecast-metric-pills" role="group" aria-label="Heatmap metric">
            {HEATMAP_METRIC_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`metric-pill ${heatmapMetric === opt.key ? 'active' : ''}`}
                onClick={() => onChangeMetric(opt.key)}
                disabled={!heatmapVisible}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`heatmap-toggle-btn ${heatmapVisible ? 'on' : ''}`}
            onClick={onToggleVisible}
          >
            {heatmapVisible ? 'Heatmap On' : 'Heatmap Off'}
          </button>
        </div>
      </div>

      <div className="forecast-peak-bar">
        <span className="forecast-peak-tag">
          <span
            className="forecast-peak-dot"
            style={{ backgroundColor: RISK_COLORS[corridorPeak.peakLevel] }}
          />
          Corridor Peak: <strong>{corridorPeak.peakLevel}</strong>
        </span>
        <span className="forecast-peak-sep">•</span>
        <span>Wind {corridorPeak.maxWind.toFixed(1)} mph</span>
        <span className="forecast-peak-sep">•</span>
        <span>Rain {corridorPeak.maxRain.toFixed(2)} in/h</span>
        <span className="forecast-peak-sep">•</span>
        <span>Snow {corridorPeak.maxSnow.toFixed(2)} in/h</span>
      </div>

      <div className="forecast-scrub-row">
        <button
          type="button"
          className="play-scrub-btn"
          onClick={() => setPlaying((p) => !p)}
          disabled={!heatmapVisible}
          title={playing ? 'Pause forecast playback' : 'Play 48-hour forecast'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <span className="scrub-bound">0h</span>
        <input
          type="range"
          min={0}
          max={maxHours}
          step={1}
          value={forecastHour}
          disabled={!heatmapVisible}
          onChange={(e) => {
            setPlaying(false)
            onChangeHour(Number(e.target.value))
          }}
          className="forecast-range-input"
          aria-label="Forecast hour offset from 0 to 48 hours"
        />
        <span className="scrub-bound">48h</span>
      </div>
    </div>
  )
}
