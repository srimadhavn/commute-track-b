# API Contract (shared by Track A and Track B)

The frontend only depends on this contract, so it works against either backend.

## GET /stations?limit=N
```json
{ "retrieved_at": "ISO-8601", "station_count": 2507,
  "stations": [{ "station_id": "...", "name": "...", "lat": 40.7, "lon": -73.9, "capacity": 20,
                 "bikes_available": 5, "ebikes_available": 2, "docks_available": 13,
                 "is_renting": true, "last_reported": 1789047572 }] }
```

## POST /plan-trip
Request: `origin` and `destination` are each either free text or `{lat, lon}`.
```json
{ "origin": "Times Square, New York", "destination": { "lat": 40.6928, "lon": -73.9903 } }
```
Response 200:
```json
{ "origin": {"lat":0,"lon":0}, "destination": {"lat":0,"lon":0},
  "currency": {"code":"USD","symbol":"$"}, "generated_at": "ISO-8601",
  "trip_distance_km": 11.0, "live_bike_data_used": true,
  "options": [{
    "id": "bike_rail", "name": "Bike-share + Subway",
    "total_time_min": 38, "total_distance_km": 11.2, "total_cost": 7.89, "total_co2_g": 410,
    "composite_score": 0.12, "data_quality": "estimated",
    "tags": ["best_overall", "greenest"],
    "vs_car": { "time_diff_min": 9, "cost_savings": 3.31, "co2_savings_g": 2330 },
    "legs": [{ "mode": "bike", "distance_km": 2.2, "duration_min": 8.8, "source": "estimate",
               "station": { "id": "...", "name": "...", "bikes_available": 7, "ebikes_available": 2 } }]
  }] }
```
Errors: `400 {"error": "..."}` for bad input, `500 {"error": "Internal error"}`.

## GET /health
`{ "status": "ok", "stations_last_updated": "ISO-8601", "station_count": 2507 }` (used by monitoring in both tracks)

## Notes
- `data_quality: "routed"` means all legs came from OpenRouteService; `"estimated"` means at least one leg was modelled from speed/distance config. The UI should show this honestly.
- Transit legs are always estimated until GTFS routing is added (stretch feature F10).
