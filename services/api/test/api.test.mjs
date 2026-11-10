import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, fakeRouter, post } from "./helpers.mjs";

const station = { station_id: "s1", name: "Test St", lat: 40.7585, lon: -73.9858, capacity: 30, bikes_available: 5, ebikes_available: 1, docks_available: 25, is_renting: true, last_reported: 1789047552 };
const now = new Date();
let nearbyCalls = [];
const repo = {
  summary: async () => ({ count: 1, lastUpdated: now }),
  listStations: async (limit) => [station].slice(0, limit),
  nearbyStations: async (pt, opts) => { nearbyCalls.push({ pt, opts }); return [station]; },
};
let ctx;
before(async () => { ctx = await startApp(repo, fakeRouter({ places: { "Times Square": { lat: 40.758, lon: -73.9855 }, "Brooklyn Bridge": { lat: 40.7061, lon: -73.9969 } } })); });
after(() => ctx.close());

test("GET /health is ok when data is fresh", async () => {
  const body = await (await fetch(ctx.base + "/health")).json();
  assert.equal(body.status, "ok");
  assert.equal(body.station_count, 1);
  assert.ok(body.stations_last_updated);
});

test("GET /health reports stale and empty without failing", async () => {
  const stale = await startApp({ ...repo, summary: async () => ({ count: 5, lastUpdated: new Date(Date.now() - 3600e3) }) }, fakeRouter());
  assert.equal((await (await fetch(stale.base + "/health")).json()).status, "stale");
  await stale.close();
  const empty = await startApp({ ...repo, summary: async () => ({ count: 0, lastUpdated: null }) }, fakeRouter());
  const res = await fetch(empty.base + "/health");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "empty");
  await empty.close();
});

test("GET /health is 503 when the database is down", async () => {
  const down = await startApp({ ...repo, summary: async () => { throw new Error("boom"); } }, fakeRouter());
  const res = await fetch(down.base + "/health");
  assert.equal(res.status, 503);
  assert.equal((await res.json()).status, "error");
  await down.close();
});

test("GET /stations matches the contract shape", async () => {
  const body = await (await fetch(ctx.base + "/stations?limit=1")).json();
  assert.deepEqual(Object.keys(body).sort(), ["retrieved_at", "station_count", "stations"]);
  assert.deepEqual(Object.keys(body.stations[0]).sort(), [
    "bikes_available", "capacity", "docks_available", "ebikes_available", "is_renting", "last_reported", "lat", "lon", "name", "station_id",
  ]);
});

test("GET /stations rejects a bad limit", async () => {
  for (const bad of ["abc", "0", "-1", "99999", "1.5"]) {
    assert.equal((await fetch(`${ctx.base}/stations?limit=${bad}`)).status, 400, bad);
  }
});

test("POST /plan-trip with coordinates uses nearby stations around the ORIGIN", async () => {
  nearbyCalls = [];
  const res = await post(ctx.base, "/plan-trip", { origin: { lat: 40.758, lon: -73.9855 }, destination: { lat: 40.6928, lon: -73.9903 } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.live_bike_data_used, true);
  assert.deepEqual(nearbyCalls[0].pt, { lat: 40.758, lon: -73.9855 });
  assert.equal(nearbyCalls[0].opts.radiusM, 1000); // CONFIG.hybrid.max_station_km
  assert.ok(body.options.find((o) => o.id === "bike_rail"));
});

test("POST /plan-trip with text origin uses the geocoded origin (not the destination)", async () => {
  nearbyCalls = [];
  const res = await post(ctx.base, "/plan-trip", { origin: "Times Square", destination: "Brooklyn Bridge" });
  assert.equal(res.status, 200);
  assert.deepEqual(nearbyCalls[0].pt, { lat: 40.758, lon: -73.9855 });
});

test("POST /plan-trip validation errors are 400 with {error}", async () => {
  for (const body of [{}, { origin: "x" }, { origin: "a", destination: "b" }, { origin: { lat: 999, lon: 0 }, destination: { lat: 1, lon: 1 } }, { origin: "Nowhere", destination: "Times Square" }]) {
    const res = await post(ctx.base, "/plan-trip", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof (await res.json()).error, "string");
  }
});

test("POST /plan-trip malformed JSON is 400, not 500", async () => {
  const res = await post(ctx.base, "/plan-trip", "{not json", true);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid JSON" });
});

test("a failing station query degrades to no live data and is counted", async () => {
  const bad = await startApp({ ...repo, nearbyStations: async () => { throw new Error("db"); } }, fakeRouter());
  const res = await post(bad.base, "/plan-trip", { origin: { lat: 40.758, lon: -73.9855 }, destination: { lat: 40.6928, lon: -73.9903 } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.live_bike_data_used, false);
  assert.match(await bad.metrics.registry.metrics(), /station_query_failures_total 1/);
  await bad.close();
});

test("ORS outage still returns 200 (estimates) and shows up in metrics", async () => {
  const down = await startApp(repo, fakeRouter({ failRoute: true }));
  const res = await post(down.base, "/plan-trip", { origin: { lat: 40.758, lon: -73.9855 }, destination: { lat: 40.6928, lon: -73.9903 } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.options.find((o) => o.id === "car").data_quality, "estimated");
  assert.match(await down.metrics.registry.metrics(), /ors_requests_total\{op="route",result="error"\} [1-9]/);
  await down.close();
});

test("GET /metrics exposes the expected series", async () => {
  await fetch(ctx.base + "/health");
  const text = await (await fetch(ctx.base + "/metrics")).text();
  for (const name of ["http_request_duration_seconds_bucket", "stations_count 1", "stations_age_seconds", "plan_trip_live_data_total", "ors_requests_total"]) {
    assert.ok(text.includes(name), `missing ${name}`);
  }
  assert.ok(!text.includes("/stations?limit"), "raw URLs must not become label values");
});

test("unknown routes are JSON 404; CORS headers are set; OPTIONS preflight is 204", async () => {
  const nf = await fetch(ctx.base + "/nope");
  assert.equal(nf.status, 404);
  assert.deepEqual(await nf.json(), { error: "Not found" });
  const pre = await fetch(ctx.base + "/plan-trip", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
});
