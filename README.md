# Weather-Aware Truck Routing

A full-stack **React + TypeScript + Mapbox GL JS** and **Django REST Framework** web application that helps truck drivers and dispatchers choose the safest route by balancing **ETA-aligned forecasted weather**, **cargo load weight**, and **travel time**.

- **Live Application:** [https://spottermaptrucker.replyanai.online](https://spottermaptrucker.replyanai.online)
- **Loom Walkthrough (5–10 min):** *(Add your Loom link here before submitting)*

---

## Key Capabilities

- **3 Truck-Legal Route Options:** Queries **HERE Routing API v8** (`transportMode=truck` + gross vehicle weight) with automatic toll-free, shortest-distance, and lateral-corridor fallbacks when a highway corridor returns fewer than 3 natural alternatives.
- **ETA-Aligned Checkpoint Sampling (`10 / 25 / 50 mi`):** Walks route polylines via Haversine geometry to sample checkpoints from Origin (`0 mi`) to Destination, evaluating forecasted weather at the **exact estimated arrival time (ETA)** of the truck at each mile marker.
- **Weather & Heavy-Load Risk Engine:** Classifies Wind (`mph`), Rain (`in/hr`), and Snow (`in/hr`) at every checkpoint and applies heavy-load wind escalations (`> 30,000 lb` and `> 40,000 lb`).
- **Safety-First Route Recommendation:** Aggregates Voronoi-weighted miles spent in each risk tier and ranks routes lexicographically (`No Travel` → `Severe` → `High` → `Average Risk` → `Travel Time`), surfacing a plain-English explanation and a **No Travel Advisory** when extreme conditions affect all routes.
- **60 FPS `0–48h` Corridor Weather Heatmap:** Precomputes a 49-frame (`0–48h`) weather matrix across a uniform 2D corridor lattice so scrubbing or auto-playing the forecast slider updates WebGL layers via `requestAnimationFrame` with **zero network calls**.
- **Interactive Map & Responsive UI:** Displays all 3 routes, clickable/hoverable risk checkpoints with ETA weather popups, `Composite Risk / Wind / Rain / Snow` heatmap toggles, Night/Day navigation styles, and an expandable in-map **Thresholds & Load Rules** reference card across desktop and mobile.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend (`fe/`)** | React 19, TypeScript, Vite 8, Mapbox GL JS v3, Axios |
| **Backend (`be/`)** | Python 3.11, Django 5.2, Django REST Framework, `django-cors-headers`, `flexpolyline`, Gunicorn |
| **External APIs** | HERE Routing API v8 & Geocoding/Search v1, OpenWeather Forecast 2.5 / One Call 3.0, Mapbox Vector Tiles |
| **Deployment** | Docker & Docker Compose (Multi-stage Node 22 → Nginx Alpine frontend + Python 3.11 Slim backend) |

---

## Project Structure

```text
.
├── be/                             # Django 5.2 REST API
│   ├── api/                        # DRF views, request validation serializers, URL routes
│   ├── common/                     # Risk constants, unit factors, typed domain exceptions
│   ├── config/                     # Django settings, WSGI/ASGI, LocMemCache configuration
│   ├── integrations/               # HERE Routing/Geocoding & OpenWeather HTTP clients
│   ├── services/                   # Core domain logic:
│   │   ├── checkpoint_generator.py # Haversine sampling, ETA math & 2D corridor lattice
│   │   ├── risk_calculator.py      # Wind/Rain/Snow thresholds & load-weight escalations
│   │   ├── recommendation.py       # Voronoi risk-mile aggregation & tie-breaker ranking
│   │   └── route_planner.py        # End-to-end route analysis & 0–48h heatmap builder
│   ├── tests/                      # 20 unit & API integration tests
│   └── Dockerfile
├── fe/                             # React + TypeScript + Vite SPA
│   ├── src/
│   │   ├── api/                    # Typed Axios client & error normalization
│   │   ├── components/             # Mapbox canvas, RiskLegend, ForecastSlider, Sidebar cards
│   │   ├── constants/              # Risk colors, map styles & threshold reference tables
│   │   ├── interfaces/             # Centralized TypeScript interfaces & ambient GeoJSON types
│   │   └── utils/                  # Distance, duration, timestamp & coordinate formatters
│   ├── nginx.conf                  # Gzip + SPA routing + /api/ reverse proxy
│   └── Dockerfile
├── scripts/dev.mjs                 # Root launcher to run BE + FE together in one terminal
├── docker-compose.yml              # Production container orchestration
└── package.json                    # Root convenience scripts (`npm run dev`, `npm run test:be`)
```

---

## Weather Risk, Unit Conversions & Recommendation Logic

### 1. Checkpoint Weather Thresholds

| Condition | Low | Moderate | High | Severe | No Travel |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Wind** | `< 25 mph` | `25–34 mph` | `35–44 mph` | `45–54 mph` | `≥ 55 mph` |
| **Rain** | `< 0.10 in/hr` | `0.10–0.25 in/hr` | `0.25–0.50 in/hr` | `0.50–1.00 in/hr` | `> 1.00 in/hr` |
| **Snow** | `< 0.5 in/hr` | `0.5–1.0 in/hr` | `1.0–2.0 in/hr` | `2.0–3.0 in/hr` | `> 3.0 in/hr` |

### 2. Heavy-Load Wind Escalations
- `≥ 55 mph` wind → **No Travel** for any load
- `45–54 mph` wind + `> 30,000 lb` load → **No Travel** *(escalates `Severe` → `No Travel`)*
- `35–44 mph` wind + `> 40,000 lb` load → **Severe** *(escalates `High` → `Severe`)*

Each checkpoint's composite risk is the **maximum (worst)** tier across Wind (after load rules), Rain, and Snow at that checkpoint's ETA.

### 3. OpenWeather Precipitation & Snow Depth Conversion
Even when queried with `units=imperial` (which returns `wind.speed` in `mph`), OpenWeather returns `rain` and `snow` in **millimeters of liquid water equivalent** (`3h` totals in Forecast 2.5; `1h` totals in One Call 3.0):
- **Rain (`in/hr`):** `(mm_per_hour) / 25.4`
- **Snow (`in/hr` accumulation):** Applies the standard **10:1 snow-to-liquid ratio (SLR)** to convert melted liquid equivalent into snowfall depth: `(mm_liquid_per_hour * 10) / 25.4`

### 4. Route Recommendation Tie-Breakers
Each checkpoint covers its Voronoi road segment (`segment_miles` summing to total route mileage). Routes are ranked in strict lexicographical order:
1. **Fewest `No Travel` miles** *(if even the winning route has `No Travel > 0 mi`, `has_no_travel_advisory` triggers a prominent warning banner)*
2. **Fewest `Severe` miles**
3. **Fewest `High` miles**
4. **Lowest distance-weighted average risk score** (`0 = Low` … `4 = No Travel`)
5. **Shortest travel time**

---

## Performance & Rate-Limit Architecture

- **Bounded Corridor Station Grid (`<= 32` points):** Querying OpenWeather directly for hundreds of `10 mi` checkpoints across 3 cross-country routes would exceed free-tier `60 calls/min` rate limits. Instead, the backend builds a deduplicated corridor station grid (`<= 32` coordinates), fetches forecasts concurrently (`ThreadPoolExecutor`), caches responses in `LocMemCache` for **30 minutes**, and computes exact checkpoint & heatmap values using **Inverse-Distance-Weighted (IDW) spatial + linear temporal interpolation**.
- **60 FPS WebGL Heatmap Scrubbing:** Rather than re-fetching weather on slider drag or relying on density-summed KDE heatmaps (which distort where routes overlap), the backend returns a uniform corridor lattice with compact `[intensity, risk_score, wind_mph, rain_in_hr, snow_in_hr]` tuples for hours `0..48`. On the client, `RouteMap` updates a pre-allocated GeoJSON `FeatureCollection` skeleton inside `requestAnimationFrame` via `source.setData()`.

---

## Local Development Setup

### Prerequisites
- **Python 3.11+**
- **Node.js 22.12+** (or `20.19+`) and `npm`
- API keys for **HERE** (Routing v8 + Geocoding v1), **OpenWeather**, and **Mapbox GL JS** (`pk.*` public token)

### 1. Configure Environment Variables

Copy the example templates in both `be/` and `fe/`:

```bash
cp be/.env.example be/.env
cp fe/.env.example fe/.env
```

Fill in your credentials:
- **`be/.env`**: `HERE_API_KEY`, `OPENWEATHER_API_KEY` (`OPENWEATHER_MODE` defaults to free `forecast25`, or `onecall30` with automatic fallback to `forecast25`).
- **`fe/.env`**: `VITE_MAPBOX_ACCESS_TOKEN` (`VITE_API_BASE_URL` defaults to `http://127.0.0.1:8000/api` locally).

### 2. Install Dependencies

**Backend (`be/`):**
```bash
cd be
python -m venv venv
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# macOS / Linux:
# source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
cd ..
```

**Frontend (`fe/`):**
```bash
cd fe
npm install
cd ..
```

### 3. Run Both Backend & Frontend in 1 Command (From Root)

```bash
npm run dev
```
- **Frontend UI:** `http://localhost:5173`
- **Backend API:** `http://127.0.0.1:8000/api`

### 4. Run Automated Tests & Production Build Check

```bash
# Run all 20 backend unit & API tests
npm run test:be

# Type-check & build the frontend bundle
npm run build
```

---

## Docker & VPS Deployment

Build and start both containers (`spotter-routing-be` on Gunicorn and `spotter-routing-fe` on Nginx, which reverse-proxies `/api/*` internally to Django):

```bash
# Ensure fe/.env sets VITE_API_BASE_URL=/api in production
docker compose --env-file fe/.env up -d --build
```

If port `80` on the host is already used by a system reverse proxy (e.g., Nginx + Certbot), bind to a local loopback port instead:

```bash
FRONTEND_PORT=127.0.0.1:3080 docker compose --env-file fe/.env up -d --build
```

---

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health/` | Service readiness and API-key configuration status |
| `GET` | `/api/geocode/?q=<query>&limit=5` | HERE location autocomplete suggestions (`{ label, lat, lng }`) |
| `POST` | `/api/routes/plan/` | Computes up to 3 truck routes, ETA checkpoints, risk summaries, recommendation, and `0–48h` corridor heatmap |

**Sample `POST /api/routes/plan/` Request Body:**
```json
{
  "origin": "Chicago, IL",
  "destination": "Denver, CO",
  "departure_time": "2026-11-03T18:00:00Z",
  "load_weight_lb": 42000,
  "interval_miles": 25
}
```

---

## Known Assumptions & Tradeoffs

1. **Forecast Horizon:** OpenWeather's 5-day (`forecast25`) / 48-hour (`onecall30`) forecast window covers near-term dispatch planning; checkpoints with ETAs beyond the final forecast timestamp clamp to the latest available forecast slot.
2. **Route Speed Interpolation:** Checkpoint ETAs interpolate linearly along total route duration (`departure_time + duration * (checkpoint_miles / total_miles)`), providing fast, deterministic arrival estimates across long-haul highway corridors.
3. **Gross Truck Weight vs. Cargo Load Weight:** HERE Routing v8 receives `30,000 lb` empty tractor-trailer tare + user `load_weight_lb` (converted to `kg`) for bridge/road restrictions, while the weather wind escalation rules evaluate strictly against the user-entered `load_weight_lb` per specification.

