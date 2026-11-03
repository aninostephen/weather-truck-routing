# Weather-Aware Truck Routing — Specification & Architecture Notes

## 1. Project Overview
Build a **React + Django** web application (Spotter Full Stack Developer Assessment) that helps a truck driver choose the safest route based on **weather**, **load weight**, and **travel time**.

### Evaluation Breakdown & Guiding Priority
- **40%** Routes, weather, risk & recommendation logic
- **40%** UI, map & heatmap smoothness and performance
- **15%** Code quality
- **5%** Documentation & 5–10 min Loom walkthrough (+ GitHub repo & hosted app)
- **Guiding rule**: *Prioritize correctness and clarity over extra features.*

---

## 2. Current Workspace Layout
- **`be/`** — Django 5.2 backend (`config`), Python virtual environment (`venv`), `djangorestframework`, `django-cors-headers`, `python-dotenv`, `requests`.
- **`fe/`** — React 19 + TypeScript + Vite frontend with `mapbox-gl`, `axios`, `react-router-dom`.

---

## 3. Functional Requirements (From Assessment PDF)

### User Inputs
- **Origin & Destination** (geocoded locations / autocomplete)
- **Departure Date & Time**
- **Load Weight** (`lb`)
- **Sampling Interval**: `10`, `25`, or `50` miles

### Core App Capabilities
1. **Generate 3 route options** using a routing API.
2. **Sample weather every `10 / 25 / 50` miles**, using the truck's **estimated arrival time (ETA)** at each checkpoint (`departure_time + elapsed_duration_to_checkpoint`).
3. **Calculate weather risk** at each checkpoint using the base thresholds + load escalation rules.
4. **Recommend the best route**, balancing weather risk and travel time.
5. **Interactive Map**: Display all 3 routes, checkpoints, risk levels, ETAs, and route summaries.
6. **Corridor Weather Heatmap**: Display a weather heatmap along the trip corridor with a smooth **0–48 hour forecast slider**.

---

## 4. Weather Risk & Recommendation Rules

### Base Weather Thresholds (Per Checkpoint)

| Condition | Low | Moderate | High | Severe | No Travel |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Wind** | `< 25 mph` | `25–34 mph` | `35–44 mph` | `45–54 mph` | `≥ 55 mph` |
| **Rain** | `< 0.10 in/hr` | `0.10–0.25 in/hr` | `0.25–0.50 in/hr` | `0.50–1.00 in/hr` | `> 1.00 in/hr` |
| **Snow** | `< 0.5 in/hr` | `0.5–1.0 in/hr` | `1.0–2.0 in/hr` | `2.0–3.0 in/hr` | `> 3.0 in/hr` |

### Load Weight Escalation Rules (Applied to Wind)
- `≥ 55 mph` → **No Travel** for any load
- `45–54 mph` + `> 30,000 lb` → **No Travel** *(escalates Severe → No Travel)*
- `35–44 mph` + `> 40,000 lb` → **Severe** *(escalates High → Severe)*

> **Checkpoint Composite Risk**: The **maximum (worst)** risk tier across Wind (after load rules), Rain, and Snow at that checkpoint's ETA.

### Route Recommendation Tie-Breaking Order
Prefer routes in strict lexicographical order:
1. *(Proposed top guard)* **Fewest `No Travel` miles** *(flag prominently with a No Travel Advisory if `> 0`)*
2. **Fewest `Severe` miles**
3. **Fewest `High` miles**
4. **Lowest average risk** *(distance-weighted numeric score across checkpoints)*
5. **Shortest travel time**

---

## 5. Selected Third-Party API Stack & Engineering Notes

### A. Mapbox GL JS (`mapbox-gl`)
- **Role**: Hardware-accelerated WebGL map rendering (`line` layers for routes, `circle` layers for checkpoints, `heatmap` layer for the 0–48h corridor forecast).
- **Performance Goal**: Preload the 0–48h corridor forecast dataset into client memory so scrubbing the 0–48h slider updates the Mapbox GeoJSON source at **60 FPS with zero network calls during scrubbing**.

### B. HERE Routing API v8 (`https://router.hereapi.com/v8/routes`)
- **Role**: Truck-aware routing + Origin/Destination geocoding/autosuggest (via HERE Geocoding & Search API).
- **Key Parameters**:
  - `transportMode=truck` — respects truck legal roads, bridge restrictions, and realistic truck speeds/ETAs.
  - `vehicle[grossWeight]=<kg>` — truck gross weight in **kilograms** (note: risk escalation rules in the PDF still evaluate strictly against the user-entered **load weight** in `lb`).
  - `alternatives=2` — returns 1 primary + 2 alternative routes = **3 routes total**.
  - `departureTime=<ISO-8601>` — time-dependent traffic and ETA calculation.
  - `return=polyline,summary,routeLabels` — returns highway labels and geometry.
- **Implementation Gotchas**:
  1. **Flexible Polyline**: HERE v8 encodes route geometry in HERE Flexible Polyline format (decode on backend with Python `flexpolyline`).
  2. **Guaranteeing 3 Routes**: If HERE returns `< 3` natural alternatives for a given corridor, trigger a fallback route call (e.g., `avoid[features]=tollRoad` or a midpoint waypoint offset) so the app always presents 3 options.

### C. OpenWeather API
- **Role**: Forecasted Wind, Rain, and Snow along the routes and trip corridor.
- **Critical Gotchas & Mitigations**:
  1. **Rate Limits & No Multi-Point Batching**:
     - OpenWeather requires 1 HTTP call per `(lat, lon)`. Free tier limit is **60 calls/min** (and One Call 3.0 has a **1,000 calls/day** free quota).
     - Querying 600 raw checkpoints (e.g., 2,000-mile route at 10-mile intervals × 3 routes) directly will trigger `429 Too Many Requests` and exhaust daily quota.
     - **Mitigation**: Sample **~25–35 deduplicated spatial grid points** along the trip corridor (cached by rounded `(lat, lon)` for ~30 minutes), fetch concurrently, and **spatially + temporally interpolate** weather onto all `10 / 25 / 50` mile checkpoints AND reuse that corridor grid to power the 0–48h heatmap.
  2. **Endpoint Tier Difference (`2.5/forecast` vs `3.0/onecall`)**:
     - **One Call 3.0 (`/data/3.0/onecall`)**: True **1-hour steps for 48 hours** (requires billing card on file for the 1,000/day free tier).
     - **Free 2.5 (`/data/2.5/forecast`)**: **3-hour steps for 5 days** (no card required). If using 2.5, linearly interpolate between adjacent 3-hour slots for checkpoint ETAs and hourly `0..48` heatmap frames, and divide 3-hour precipitation totals by `3` to obtain hourly rates.
  3. **Precipitation & Snow Unit Conversion Trap**:
     - Even with `units=imperial` (`wind_speed` in **mph**), OpenWeather always returns `rain` and `snow` in **millimeters of liquid water equivalent (`mm`)**.
     - **Rain (`in/hr`)**: `mm_per_hour / 25.4`
     - **Snow (`in/hr` accumulation depth)**: OpenWeather `snow` is melted liquid water, whereas the PDF thresholds (`0.5–3.0+ in/hr`) measure snowfall depth. Apply the standard **10:1 snow-to-liquid ratio (SLR)**: `(mm_liquid_per_hour * 10) / 25.4`.

---

## 6. Finalized Decisions & Backend Implementation (`be/`)
- [x] **OpenWeather Key Tier**: Supports both via `OPENWEATHER_MODE` env toggle, defaulting to **Free `2.5/forecast`** (`/data/2.5/forecast`, interpolated to hourly) with optional `onecall30` (`/data/3.0/onecall`, auto-falling back to `2.5` if unauthorized).
- [x] **`No Travel` Ranking Priority**: Ranked strictly #1 ahead of `Severe` miles (`No Travel → Severe → High → Avg Risk → Travel Time`), with `has_no_travel_advisory` flagged when all routes encounter `No Travel`.
- [x] **Sampling Selector**: Validates `10`, `25`, `50` miles (defaulting to `25 mi`).
- [x] **HERE Truck Weight Input**: Passes `30,000 lb tractor tare + load_weight_lb` (converted to `kg`) to HERE `vehicle[grossWeight]`, while evaluating PDF risk escalations strictly against `load_weight_lb`.

### Backend Folder Structure & Endpoints
- `be/api/` — DRF endpoints:
  - `GET /api/health/` — readiness + API key configuration check
  - `GET /api/geocode/?q=<query>` — HERE location autocomplete
  - `POST /api/routes/plan/` — full 3-route truck analysis + checkpoints + recommendation + 0–48h corridor heatmap
- `be/services/` — `route_planner.py`, `checkpoint_generator.py`, `risk_calculator.py`, `recommendation.py`
- `be/integrations/` — `here_client.py` (with `flexpolyline` + 3-route fallback), `openweather_client.py` (with `LocMemCache` + IDW spatial/temporal interpolation)
- `be/common/` — `constants.py`, `exceptions.py`
- `be/tests/` — 20 unit & integration tests covering thresholds, tie-breakers, geometry, unit conversions, and endpoints


