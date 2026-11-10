// REAL Postgres+PostGIS, REAL repo, REAL app; only OpenRouteService is stubbed.
// Skipped unless TEST_PG=1 (with PG* env vars).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { createRepo } from "../src/repo.mjs";
import { startApp, fakeRouter, post } from "./helpers.mjs";

const skip = process.env.TEST_PG !== "1" && "set TEST_PG=1 with PG* env vars to run";
let pool, repo;

// Times Square area. Distances from (40.7580, -73.9855):
const S = (id, name, lat, lon, bikes, renting = true) => [id, name, lat, lon, bikes, renting];
const SEED = [
  S("near-empty", "Nearest but EMPTY", 40.7581, -73.9856, 0),
  S("near-closed", "Near but NOT RENTING", 40.7582, -73.9857, 4, false),
  S("near-ok", "Near and usable", 40.7590, -73.9860, 6),
  S("mid-ok", "Mid usable", 40.7640, -73.9870, 3),
  S("far", "Far away (Brooklyn)", 40.6928, -73.9903, 9),
];

before(async () => {
  if (skip) return;
  pool = new pg.Pool();
  await pool.query(readFileSync(new URL("../../../db/init/01-schema.sql", import.meta.url), "utf8"));
  await pool.query("TRUNCATE stations");
  for (const [id, name, lat, lon, bikes, renting] of SEED) {
    await pool.query(
      `INSERT INTO stations (station_id,name,lat,lon,geom,capacity,bikes_available,ebikes_available,docks_available,is_renting,is_returning,last_reported)
       VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,30,$5,1,10,$6,true,1789047552)`,
      [id, name, lat, lon, bikes, renting]);
  }
  repo = createRepo(pool);
});
after(async () => { await pool?.end(); });

const origin = { lat: 40.758, lon: -73.9855 };

test("nearbyStations: only usable stations, nearest first, within radius", { skip }, async () => {
  const rows = await repo.nearbyStations(origin, { radiusM: 1000, limit: 10 });
  assert.deepEqual(rows.map((r) => r.station_id), ["near-ok", "mid-ok"]); // empty/closed/far excluded
});

test("nearbyStations: radius and limit are honoured", { skip }, async () => {
  assert.equal((await repo.nearbyStations(origin, { radiusM: 200, limit: 10 })).length, 1);
  assert.equal((await repo.nearbyStations(origin, { radiusM: 50000, limit: 1 })).length, 1);
});

test("nearbyStations: last_reported comes back as a number", { skip }, async () => {
  const [r] = await repo.nearbyStations(origin, { radiusM: 1000, limit: 1 });
  assert.equal(typeof r.last_reported, "number");
});

test("summary and listStations reflect the table", { skip }, async () => {
  const s = await repo.summary();
  assert.equal(s.count, 5);
  assert.ok(s.lastUpdated instanceof Date);
  assert.equal((await repo.listStations(2)).length, 2);
});

test("END TO END: /plan-trip picks the usable station and reports live data", { skip }, async () => {
  const ctx = await startApp(repo, fakeRouter());
  const res = await post(ctx.base, "/plan-trip", { origin, destination: { lat: 40.6928, lon: -73.9903 } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.live_bike_data_used, true);
  const hybrid = body.options.find((o) => o.id === "bike_rail");
  assert.equal(hybrid.legs.find((l) => l.mode === "bike").station.id, "near-ok"); // not the empty/closed ones that are closer
  await ctx.close();
});

test("END TO END: origin with no usable station nearby -> no hybrid, live_bike_data_used false", { skip }, async () => {
  const ctx = await startApp(repo, fakeRouter());
  try {
    // Southern Staten Island: inside the NYC service area, but no seeded station within 1 km.
    const res = await post(ctx.base, "/plan-trip", { origin: { lat: 40.52, lon: -74.2 }, destination: { lat: 40.6928, lon: -73.9903 } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.live_bike_data_used, false);
    assert.equal(body.options.find((o) => o.id === "bike_rail"), undefined);
  } finally {
    await ctx.close();
  }
});
