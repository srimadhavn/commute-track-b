# Commute Planner: Track B (open-source DevOps stack)

Phase B1: ingestor + api + PostGIS, via Docker Compose.

```
Citi Bike GBFS --(every 2 min)--> ingestor --> PostgreSQL/PostGIS <-- api <-- frontend
                                      |                                |
                                  :9101/metrics                    :3000/metrics
```

- `packages/commute-core`: shared core, **unmodified** (also used by Track A).
- `services/ingestor`: GBFS -> Postgres upsert, exposes `/metrics` and `/healthz`.
- `services/api`: Express wrapper around `handlePlanTrip`; `GET /stations`, `POST /plan-trip`, `GET /health`, `GET /metrics`.
- `db/init/01-schema.sql`: schema + PostGIS index (runs on first start of an empty volume only).

## Run (PowerShell)

```powershell
Copy-Item .env.example .env
notepad .env                      # set ORS_API_KEY and POSTGRES_PASSWORD (letters+digits only)
docker compose config --quiet     # validates .env + compose; silent = OK
docker compose up --build -d
docker compose ps                 # wait for db / ingestor / api to show (healthy)
```

## Tests (no Docker needed, Node 22)

```powershell
npm install
npm test                          # unit tests; DB integration tests are skipped
```
DB integration tests run against any PostGIS when `TEST_PG=1` and `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` are set.

## Monitoring (B2a: Prometheus + Grafana)

```powershell
# add GRAFANA_ADMIN_PASSWORD=<letters+digits> to your .env first (see .env.example)
docker compose up -d
```
- Prometheus: http://localhost:9090 (Status > Target health shows api / ingestor / prometheus as UP)
- Grafana: http://localhost:3001, user `admin`, password from `.env`. The "Commute Planner: Overview" dashboard is the home page.
- Dashboards are code: edit `monitoring/grafana/dashboards/*.json` in the repo (changes made in the Grafana UI are not saved).
- Failure drill: `docker compose stop ingestor`, wait ~1 min, watch "Services scraped" turn red and "Since last good ingest" climb; `docker compose start ingestor` to recover.

## Logs (B2b: Loki + Alloy)

```powershell
docker compose up -d
docker compose restart grafana     # so Grafana picks up the new Loki data source
```
- **Loki** stores logs (7 days). **Alloy** reads every container's logs from Docker and ships them to Loki. Alloy's status page: http://localhost:12345 (each component should be healthy).
- In Grafana: Dashboards > Commute > "Commute Planner: Logs". For free-text search use Explore, pick the Loki data source, and try `{service="api"} |= "ors call failed"`.
- Our own services log one JSON object per line; Alloy turns the `level` field into a label (`error` / `warn` / `info`).
- **Security note:** Alloy mounts the Docker socket (read-only flag, but the socket still allows the full Docker API) and runs as root. That is acceptable on a local machine; for the cloud VM (B3) we should revisit it (e.g. read the log files instead).

## Reset the database (re-runs db/init)

```powershell
docker compose down -v
```

## Design notes
- **Nearest-station lookups use PostGIS.** `commute-core`'s `getStations()` takes no arguments, so the API remembers where the *origin* resolved to (coordinates, or the geocoded text) and returns only renting stations with bikes within the core's `hybrid.max_station_km`, via `ST_DWithin` + `<->` on a GiST index.
- **Routing failures are visible.** The core silently falls back to estimates when OpenRouteService fails; the API wraps the router so every call is counted in `ors_requests_total{op,result}` and logged.
- **Service area.** `services/api/src/region.mjs` defines the supported region (default `nyc`, set with `REGION`). Geocoding gets a soft bias toward it (never a hard boundary, which turns wrong places into fuzzy local lookalikes), in-area candidates are preferred, and a location that still resolves outside the region gets a 400 saying what it resolved to. The core has no concept of geography. Known limit: ORS reads "Times Square, New York" as the *state*, so type "Times Square". A new city is a new entry in `region.mjs` plus its values in the core's `config.mjs`.
- **/health** returns 200 with `status: ok | stale | empty` while the DB is reachable, and 503 only if the DB is down.
- **/stations** `station_count` is the total in the DB, regardless of `limit`.
- Logs are one JSON object per line (ready for Loki in B2).
