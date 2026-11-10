import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.mjs";
import { haversineKm, nearestStationWithBikes } from "../src/geo.mjs";
import { scoreOption, rankOptions } from "../src/scoring.mjs";
import { planTrip } from "../src/planner.mjs";
import { handlePlanTrip } from "../src/handler.mjs";
import { createRouter } from "../src/routing.mjs";

// Midtown (Times Sq area) -> Downtown Brooklyn, roughly 10 km
const A = { lat: 40.758, lon: -73.9855 };
const B = { lat: 40.6928, lon: -73.9903 };

const fakeRouter = {
  async route(profile) {
    const table = {
      "driving-car": { distance_m: 11000, duration_s: 1500 },
      "cycling-regular": { distance_m: 10500, duration_s: 2400 },
      "foot-walking": { distance_m: 10200, duration_s: 7300 },
    };
    return table[profile];
  },
  async geocode(text) { return { lat: A.lat, lon: A.lon, label: text }; },
};
const failingRouter = { async route() { throw new Error("down"); }, async geocode() { throw new Error("down"); } };

const stations = [
  { station_id: "s1", name: "W 42 St & 8 Ave", lat: 40.7575, lon: -73.9890, is_renting: true, bikes_available: 7, ebikes_available: 2 },
  { station_id: "s2", name: "Empty Dock", lat: 40.7580, lon: -73.9856, is_renting: true, bikes_available: 0, ebikes_available: 0 },
  { station_id: "s3", name: "Offline", lat: 40.7581, lon: -73.9857, is_renting: false, bikes_available: 9, ebikes_available: 0 },
];

test("haversine is roughly right (~7.3 km Midtown to Downtown Brooklyn)", () => {
  const d = haversineKm(A, B);
  assert.ok(d > 7 && d < 8, `got ${d}`);
});

test("nearest station ignores empty and offline stations", () => {
  const s = nearestStationWithBikes(A, stations, 1.0);
  assert.equal(s.station_id, "s1");
  assert.equal(nearestStationWithBikes(A, [stations[1], stations[2]], 5), null);
});

test("scoring: totals for a known car leg", () => {
  const o = scoreOption("car", "Drive", [{ mode: "car", distance_km: 10, duration_min: 25, source: "routing" }], CONFIG);
  assert.equal(o.total_cost, 11.2);      // 10 flat + 0.12*10
  assert.equal(o.total_co2_g, 2490);
  assert.equal(o.data_quality, "routed");
});

test("ranking: car savings reported, tags assigned, sorted ascending", () => {
  const car = scoreOption("car", "Drive", [{ mode: "car", distance_km: 10, duration_min: 25, source: "routing" }], CONFIG);
  const rail = scoreOption("rail", "Subway", [{ mode: "rail", distance_km: 10, duration_min: 30, source: "estimate" }], CONFIG);
  const ranked = rankOptions([car, rail], CONFIG);
  assert.equal(ranked[0].id, "rail");
  assert.ok(ranked[0].tags.includes("best_overall"));
  assert.ok(ranked[0].tags.includes("greenest"));
  assert.ok(ranked[0].vs_car.co2_savings_g > 2000);
  assert.equal(ranked[1].vs_car, undefined);
});

test("planner: includes hybrid only when a station with bikes is nearby", async () => {
  const withBikes = await planTrip({ origin: A, destination: B, stations, router: fakeRouter });
  assert.ok(withBikes.options.some((o) => o.id === "bike_rail"));
  assert.equal(withBikes.live_bike_data_used, true);
  const hybrid = withBikes.options.find((o) => o.id === "bike_rail");
  assert.equal(hybrid.legs.find((l) => l.mode === "bike").station.name, "W 42 St & 8 Ave");

  const without = await planTrip({ origin: A, destination: B, stations: [stations[1]], router: fakeRouter });
  assert.ok(!without.options.some((o) => o.id === "bike_rail"));
  assert.equal(without.live_bike_data_used, false);
});

test("planner: routing outage falls back to estimates instead of failing", async () => {
  const r = await planTrip({ origin: A, destination: B, stations, router: failingRouter });
  assert.ok(r.options.length >= 3);
  assert.ok(r.options.every((o) => o.data_quality === "estimated"));
});

test("planner: short trip offers walking, long trip does not", async () => {
  const near = { lat: 40.7590, lon: -73.9845 };
  const short = await planTrip({ origin: A, destination: near, stations, router: fakeRouter });
  assert.ok(short.options.some((o) => o.id === "walk"));
  const long = await planTrip({ origin: A, destination: B, stations, router: fakeRouter });
  assert.ok(!long.options.some((o) => o.id === "walk"));
});

test("handler: validates input and geocodes text", async () => {
  const deps = { router: fakeRouter, getStations: async () => stations };
  assert.equal((await handlePlanTrip({}, deps)).statusCode, 400);
  assert.equal((await handlePlanTrip({ origin: { lat: 999, lon: 0 }, destination: B }, deps)).statusCode, 400);
  const ok = await handlePlanTrip({ origin: "Times Square", destination: B }, deps);
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.body.options.length >= 3);
});

test("handler: station store failure does not break planning", async () => {
  const deps = { router: fakeRouter, getStations: async () => { throw new Error("db down"); } };
  const r = await handlePlanTrip({ origin: A, destination: B }, deps);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.live_bike_data_used, false);
});

test("ORS adapter parses directions + geocode responses", async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => url.includes("geocode")
      ? { features: [{ geometry: { coordinates: [-73.98, 40.75] }, properties: { label: "Somewhere" } }] }
      : { routes: [{ summary: { distance: 5000, duration: 600 } }] },
  });
  const router = createRouter({ apiKey: "k", fetchImpl });
  assert.deepEqual(await router.route("driving-car", A, B), { distance_m: 5000, duration_s: 600 });
  assert.deepEqual(await router.geocode("x"), { lat: 40.75, lon: -73.98, label: "Somewhere" });
});
