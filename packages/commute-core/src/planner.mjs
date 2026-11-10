import { CONFIG } from "./config.mjs";
import { haversineKm, nearestStationWithBikes } from "./geo.mjs";
import { scoreOption, rankOptions } from "./scoring.mjs";

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

function estLeg(mode, km, config, extraMin = 0, extra = {}) {
  const speed = config.modes[mode].avg_speed_kmh;
  return { mode, distance_km: r2(km), duration_min: r1((km / speed) * 60 + extraMin), source: "estimate", ...extra };
}

async function routedLeg(router, profile, mode, from, to, config) {
  try {
    const r = await router.route(profile, from, to);
    return { mode, distance_km: r2(r.distance_m / 1000), duration_min: r1(r.duration_s / 60), source: "routing" };
  } catch {
    const km = haversineKm(from, to) * config.limits.road_factor;
    return estLeg(mode, km, config);
  }
}

export async function planTrip({ origin, destination, stations = [], router, config = CONFIG }) {
  const straight = haversineKm(origin, destination);
  const roadKm = straight * config.limits.road_factor;
  const options = [];

  // Car: always
  const car = await routedLeg(router, "driving-car", "car", origin, destination, config);
  options.push(scoreOption("car", config.modes.car.label, [car], config));
  const tripKm = car.distance_km;

  // Transit (estimated: no free transit router yet; flagged via data_quality)
  const access = config.transit.access_walk_km;
  const rideKm = Math.max(tripKm - 2 * access, 0.5);
  for (const mode of ["rail", "bus"]) {
    options.push(scoreOption(mode, config.modes[mode].label, [
      estLeg("walk", access, config),
      estLeg(mode, rideKm, config, config.transit.wait_min),
      estLeg("walk", access, config),
    ], config));
  }

  // Bike-share + Subway hybrid: only if live data shows a bike nearby
  let hybridStation = null;
  if (tripKm >= config.hybrid.min_trip_km) {
    const st = nearestStationWithBikes(origin, stations, config.hybrid.max_station_km);
    if (st) {
      hybridStation = st;
      const h = config.hybrid;
      const walkKm = st.distance_km * config.limits.road_factor;
      const bikeKm = Math.min(Math.max(tripKm * h.bike_ratio, h.min_bike_km), h.max_bike_km);
      const ride = Math.max(tripKm - walkKm - bikeKm - access, 0.5);
      options.push(scoreOption("bike_rail", "Bike-share + Subway", [
        estLeg("walk", walkKm, config),
        estLeg("bike", bikeKm, config, 0, { station: { id: st.station_id, name: st.name, bikes_available: st.bikes_available, ebikes_available: st.ebikes_available } }),
        estLeg("rail", ride, config, config.transit.wait_min),
        estLeg("walk", access, config),
      ], config));
    }
  }

  // Bike-share only
  if (roadKm <= config.limits.bike_only_max_km) {
    const bike = await routedLeg(router, "cycling-regular", "bike", origin, destination, config);
    options.push(scoreOption("bike", config.modes.bike.label, [bike], config));
  }

  // Walk only
  if (roadKm <= config.limits.walk_only_max_km) {
    const walk = await routedLeg(router, "foot-walking", "walk", origin, destination, config);
    options.push(scoreOption("walk", config.modes.walk.label, [walk], config));
  }

  const ranked = rankOptions(options, config);
  return {
    currency: config.currency,
    generated_at: new Date().toISOString(),
    trip_distance_km: tripKm,
    live_bike_data_used: Boolean(hybridStation),
    options: ranked,
  };
}
