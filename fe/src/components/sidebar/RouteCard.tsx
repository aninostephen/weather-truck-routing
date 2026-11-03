import { RISK_COLORS, RISK_ORDER } from '../../constants/risk'
import type { RouteCardProps } from '../../interfaces'
import { formatDuration, formatShortDateTime } from '../../utils/format'

export function RouteCard({ route, isSelected, onSelect }: RouteCardProps) {
  const { risk_summary: risk } = route
  const totalMiles = Math.max(route.distance_miles, 0.1)
  const overallColor = RISK_COLORS[risk.overall_risk_level]

  return (
    <button
      type="button"
      className={`route-card ${isSelected ? 'selected' : ''} ${
        route.is_recommended ? 'recommended' : ''
      }`}
      onClick={() => onSelect(route.id)}
    >
      <div className="route-card-top">
        <div className="route-badges">
          {route.is_recommended ? (
            <span className="badge-recommended">★ Recommended</span>
          ) : (
            <span className="badge-rank">Option #{route.rank}</span>
          )}
          {risk.has_no_travel && <span className="badge-no-travel">No Travel Zone</span>}
        </div>

        <span
          className="route-overall-pill"
          style={{
            backgroundColor: overallColor,
            color:
              risk.overall_risk_level === 'Severe' ||
              risk.overall_risk_level === 'No Travel'
                ? '#ffffff'
                : '#090d16',
          }}
        >
          {risk.overall_risk_level}
        </span>
      </div>

      <div className="route-card-title">{route.name}</div>

      <div className="route-stats-row">
        <span>
          <strong>{formatDuration(route.duration_seconds)}</strong>
        </span>
        <span className="stat-sep">•</span>
        <span>{route.distance_miles.toLocaleString()} mi</span>
        <span className="stat-sep">•</span>
        <span>ETA {formatShortDateTime(route.eta)}</span>
      </div>

      <div className="risk-progress-bar" aria-label="Miles by weather risk tier">
        {RISK_ORDER.map((tier) => {
          const miles = risk.miles_by_risk[tier] ?? 0
          if (miles <= 0) {
            return null
          }
          const pct = Math.max(2, (miles / totalMiles) * 100)
          return (
            <span
              key={tier}
              style={{
                width: `${pct}%`,
                backgroundColor: RISK_COLORS[tier],
              }}
              title={`${tier}: ${miles.toFixed(1)} mi`}
            />
          )
        })}
      </div>

      <div className="route-risk-metrics">
        <div className="risk-mini-stat">
          <span className="risk-mini-label">No Travel</span>
          <span className="risk-mini-val">{risk.no_travel_miles} mi</span>
        </div>
        <div className="risk-mini-stat">
          <span className="risk-mini-label">Severe</span>
          <span className="risk-mini-val">{risk.severe_miles} mi</span>
        </div>
        <div className="risk-mini-stat">
          <span className="risk-mini-label">High</span>
          <span className="risk-mini-val">{risk.high_miles} mi</span>
        </div>
        <div className="risk-mini-stat">
          <span className="risk-mini-label">Avg Risk</span>
          <span className="risk-mini-val">{risk.average_risk.toFixed(2)}</span>
        </div>
      </div>
    </button>
  )
}

