import { SAMPLING_INTERVAL_OPTIONS } from '../../constants/risk'
import type { TripFormProps } from '../../interfaces'
import { LocationInput } from './LocationInput'

export function TripForm({
  origin,
  destination,
  departureLocal,
  loadWeightLb,
  intervalMiles,
  loading,
  onChangeOrigin,
  onChangeDestination,
  onSwapLocations,
  onChangeDeparture,
  onChangeLoadWeight,
  onChangeInterval,
  onSubmit,
}: TripFormProps) {
  const numericLoad = Number(loadWeightLb) || 0

  let loadRuleHint = 'Standard wind thresholds active (≤ 30,000 lb load).'
  if (numericLoad > 40_000) {
    loadRuleHint =
      'Heavy load rules active: 35–44 mph wind → Severe, 45–54 mph wind → No Travel.'
  } else if (numericLoad > 30_000) {
    loadRuleHint = 'Load rule active: 45–54 mph wind escalates to No Travel (> 30,000 lb).'
  }

  const canSubmit =
    !loading && origin.text.trim().length > 0 && destination.text.trim().length > 0

  return (
    <form className="trip-form" onSubmit={onSubmit}>
      <div className="locations-stack">
        <LocationInput
          id="origin-input"
          label="Origin"
          placeholder="e.g., Chicago, IL"
          dotColor="#22c55e"
          value={origin}
          onChange={onChangeOrigin}
        />

        <button
          type="button"
          className="swap-locations-btn"
          title="Swap origin and destination"
          onClick={onSwapLocations}
        >
          ⇅ Swap
        </button>

        <LocationInput
          id="destination-input"
          label="Destination"
          placeholder="e.g., Denver, CO"
          dotColor="#38bdf8"
          value={destination}
          onChange={onChangeDestination}
        />
      </div>

      <div className="form-row-two">
        <div className="form-field">
          <label htmlFor="departure-input" className="field-label">
            Departure Date / Time
          </label>
          <input
            id="departure-input"
            type="datetime-local"
            className="text-input"
            value={departureLocal}
            onChange={(e) => onChangeDeparture(e.target.value)}
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="weight-input" className="field-label">
            Load Weight (lb)
          </label>
          <input
            id="weight-input"
            type="number"
            min={0}
            max={200000}
            step={500}
            className="text-input"
            placeholder="35000"
            value={loadWeightLb}
            onChange={(e) => onChangeLoadWeight(e.target.value)}
            required
          />
        </div>
      </div>

      <div className={`load-rule-banner ${numericLoad > 30_000 ? 'active' : ''}`}>
        {loadRuleHint}
      </div>

      <div className="form-field">
        <span className="field-label">Weather Checkpoint Sampling</span>
        <div className="interval-toggle" role="group" aria-label="Sampling interval in miles">
          {SAMPLING_INTERVAL_OPTIONS.map((miles) => (
            <button
              key={miles}
              type="button"
              className={`interval-btn ${intervalMiles === miles ? 'active' : ''}`}
              onClick={() => onChangeInterval(miles)}
            >
              Every {miles} mi
            </button>
          ))}
        </div>
      </div>

      <button type="submit" className="primary-submit-btn" disabled={!canSubmit}>
        {loading ? 'Analyzing Truck Routes & Weather…' : 'Find Safest Route'}
      </button>
    </form>
  )
}

