// All tunable numbers live here. Change per city; no logic changes needed.
// CO2: car figure derived from EPA (~400 g/mile = ~249 g/km). Transit figures are
// standard per-passenger-km approximations. Fares/prices are ASSUMPTIONS: verify before publishing.
export const CONFIG = {
  currency: { code: "USD", symbol: "$" },
  city: { name: "New York City", gbfs_base: "https://gbfs.citibikenyc.com/gbfs/en" },
  modes: {
    car:  { label: "Drive",      co2_g_per_km: 249, cost_per_km: 0.12, flat_cost: 10,   avg_speed_kmh: 25 },
    bus:  { label: "Bus",        co2_g_per_km: 105, cost_per_km: 0,    flat_cost: 2.9,  avg_speed_kmh: 18 },
    rail: { label: "Subway",     co2_g_per_km: 41,  cost_per_km: 0,    flat_cost: 2.9,  avg_speed_kmh: 32 },
    bike: { label: "Bike-share", co2_g_per_km: 0,   cost_per_km: 0,    flat_cost: 4.99, avg_speed_kmh: 15 },
    walk: { label: "Walk",       co2_g_per_km: 0,   cost_per_km: 0,    flat_cost: 0,    avg_speed_kmh: 5 },
  },
  weights: { time: 0.4, cost: 0.3, co2: 0.3 },
  transit: { wait_min: 5, access_walk_km: 0.5 },
  hybrid: { max_station_km: 1.0, min_bike_km: 0.8, max_bike_km: 3, bike_ratio: 0.2, min_trip_km: 3 },
  limits: { bike_only_max_km: 12, walk_only_max_km: 3, road_factor: 1.3 },
};
