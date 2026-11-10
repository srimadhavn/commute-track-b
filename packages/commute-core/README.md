# commute-core (shared by Track A and Track B)

Platform-neutral planning logic. No AWS, no Express. Both backends import it.

- `src/config.mjs`: every tunable number (CO2, costs, weights, limits)
- `src/scoring.mjs`: per-option totals, weighted ranking, savings vs car, tags
- `src/routing.mjs`: OpenRouteService adapter (directions + geocoding)
- `src/planner.mjs`: builds options (drive, subway, bus, bike, walk, bike+subway using live station data)
- `src/handler.mjs`: validated request handler returning `{statusCode, body}`
- `docs/API_CONTRACT.md`: the JSON the frontend depends on

Run tests: `npm test` (Node 20+, no dependencies).
