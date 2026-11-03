import { useState } from 'react'

import {
  LOAD_ESCALATION_RULES,
  RISK_COLORS,
  RISK_ORDER,
  RISK_THRESHOLDS_BY_LEVEL,
} from '../../constants/risk'
import type { RiskLegendProps, RiskLevel } from '../../interfaces'

export function RiskLegend({ heatmapMetric }: RiskLegendProps) {
  const [expanded, setExpanded] = useState<boolean>(false)

  const getInlineMetricRange = (level: RiskLevel): string | null => {
    const row = RISK_THRESHOLDS_BY_LEVEL[level]
    if (heatmapMetric === 'wind') return row.wind
    if (heatmapMetric === 'rain') return row.rain
    if (heatmapMetric === 'snow') return row.snow
    return null
  }

  return (
    <div
      className={`map-risk-legend ${expanded ? 'expanded' : ''}`}
      aria-label="Weather risk legend and thresholds"
    >
      <div className="map-legend-header">
        <span className="map-legend-title">
          {expanded ? 'Weather Risk Thresholds' : 'Checkpoint & Corridor Risk'}
        </span>
        <button
          type="button"
          className={`map-legend-toggle-btn ${expanded ? 'active' : ''}`}
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          title={
            expanded
              ? 'Collapse weather thresholds'
              : 'View Wind, Rain, Snow & Load thresholds'
          }
        >
          {expanded ? '✕ Hide' : 'ⓘ Thresholds'}
        </button>
      </div>

      {!expanded ? (
        <div className="map-legend-items">
          {RISK_ORDER.map((level) => {
            const inlineRange = getInlineMetricRange(level)
            return (
              <div key={level} className="map-legend-row">
                <span
                  className="map-legend-swatch"
                  style={{ backgroundColor: RISK_COLORS[level] }}
                />
                <span className="map-legend-level">{level}</span>
                {inlineRange && (
                  <span className="map-legend-inline-range">{inlineRange}</span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="map-thresholds-body">
          <table className="map-thresholds-table">
            <thead>
              <tr>
                <th>Risk</th>
                <th className={heatmapMetric === 'wind' ? 'col-active' : ''}>
                  Wind
                  <span className="th-unit">mph</span>
                </th>
                <th className={heatmapMetric === 'rain' ? 'col-active' : ''}>
                  Rain
                  <span className="th-unit">in/hr</span>
                </th>
                <th className={heatmapMetric === 'snow' ? 'col-active' : ''}>
                  Snow
                  <span className="th-unit">in/hr</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {RISK_ORDER.map((level) => {
                const cells = RISK_THRESHOLDS_BY_LEVEL[level]
                return (
                  <tr key={level}>
                    <td className="td-risk-level">
                      <span
                        className="map-legend-swatch"
                        style={{ backgroundColor: RISK_COLORS[level] }}
                      />
                      <span>{level}</span>
                    </td>
                    <td className={heatmapMetric === 'wind' ? 'col-active' : ''}>
                      {cells.windCompact}
                    </td>
                    <td className={heatmapMetric === 'rain' ? 'col-active' : ''}>
                      {cells.rainCompact}
                    </td>
                    <td className={heatmapMetric === 'snow' ? 'col-active' : ''}>
                      {cells.snowCompact}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="map-load-rules">
            <div className="map-load-rules-title">Heavy Load Wind Rules</div>
            <ul className="map-load-rules-list">
              {LOAD_ESCALATION_RULES.map((rule) => (
                <li key={`${rule.condition}-${rule.load}`} className="map-load-rule-item">
                  <span className="load-rule-desc">
                    <strong>{rule.condition}</strong> + {rule.load}
                  </span>
                  <span
                    className="load-rule-pill"
                    style={{
                      backgroundColor: RISK_COLORS[rule.result],
                      color: '#ffffff',
                    }}
                  >
                    {rule.result}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

