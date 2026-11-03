import { RISK_COLORS } from '../../constants/risk'
import type { CheckpointListProps } from '../../interfaces'
import { formatShortDateTime } from '../../utils/format'

export function CheckpointList({
  routeName,
  intervalMiles,
  checkpoints,
  focusedCheckpointIndex,
  onFocusCheckpoint,
}: CheckpointListProps) {
  return (
    <div className="checkpoint-section">
      <div className="checkpoint-section-header">
        <div>
          <h3 className="section-subtitle">Checkpoints ({checkpoints.length})</h3>
          <p className="section-caption">
            {routeName} • sampled every {intervalMiles} mi (click row to inspect on map)
          </p>
        </div>
      </div>

      <div className="checkpoint-table-wrap">
        <table className="checkpoint-table">
          <thead>
            <tr>
              <th>Mile</th>
              <th>ETA</th>
              <th>Wind</th>
              <th>Precip</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {checkpoints.map((cp) => {
              const color = RISK_COLORS[cp.risk_level]
              const precipLabel =
                cp.weather.snow_in_hr > 0
                  ? `❄ ${cp.weather.snow_in_hr.toFixed(2)}"`
                  : cp.weather.rain_in_hr > 0
                    ? `☂ ${cp.weather.rain_in_hr.toFixed(2)}"`
                    : '0.00"'

              return (
                <tr
                  key={cp.index}
                  className={focusedCheckpointIndex === cp.index ? 'focused' : ''}
                  onClick={() => onFocusCheckpoint(cp)}
                >
                  <td className="cp-cell-mile">{cp.distance_miles.toFixed(0)} mi</td>
                  <td className="cp-cell-eta">{formatShortDateTime(cp.eta)}</td>
                  <td>
                    {cp.weather.wind_mph.toFixed(0)} mph
                    {cp.load_rule_triggered && (
                      <span
                        className="cp-load-flag"
                        title="Escalated by heavy load weight rule"
                      >
                        ⚖
                      </span>
                    )}
                  </td>
                  <td>{precipLabel}</td>
                  <td>
                    <span
                      className="cp-risk-chip"
                      style={{
                        backgroundColor: color,
                        color:
                          cp.risk_level === 'Severe' || cp.risk_level === 'No Travel'
                            ? '#ffffff'
                            : '#090d16',
                      }}
                    >
                      {cp.risk_level}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

