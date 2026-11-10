// Runs against a REAL Postgres+PostGIS. Skipped unless TEST_PG=1 (set PG* env vars to point at it).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { upsertStations } from "../src/store.mjs";
import { mergeStations } from "../src/gbfs.mjs";

const skip = process.env.TEST_PG !== "1" && "set TEST_PG=1 with PG* env vars to run";
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
let pool;

before(async () => {
  if (skip) return;
  pool = new pg.Pool();
  await pool.query(readFileSync(new URL("../../../db/init/01-schema.sql", import.meta.url), "utf8"));
  await pool.query("TRUNCATE stations");
});
after(async () => { await pool?.end(); });

test("upsert inserts, builds geography, then updates in place", { skip }, async () => {
  const { rows } = mergeStations(fx("station_information"), fx("station_status"));
  const r1 = await upsertStations(pool, rows);
  assert.equal(r1.upserted, 3);
  const { rows: [a1] } = await pool.query("SELECT bikes_available, ST_AsText(geom::geometry) AS wkt FROM stations WHERE station_id='a1'");
  assert.equal(a1.bikes_available, 7);
  assert.match(a1.wkt, /^POINT\(-73\.98915/);

  rows.find((x) => x.station_id === "a1").bikes_available = 1;
  await upsertStations(pool, rows);
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int n FROM stations");
  const { rows: [a1b] } = await pool.query("SELECT bikes_available FROM stations WHERE station_id='a1'");
  assert.equal(n, 3);
  assert.equal(a1b.bikes_available, 1);
});

test("stations that left the feed are deleted", { skip }, async () => {
  const { rows } = mergeStations(fx("station_information"), fx("station_status"));
  const r = await upsertStations(pool, rows.filter((x) => x.station_id !== "a4"));
  assert.equal(r.deleted, 1);
});

test("a truncated feed does not wipe the table", { skip }, async () => {
  const { rows } = mergeStations(fx("station_information"), fx("station_status"));
  await upsertStations(pool, rows); // 3 stations present
  const r = await upsertStations(pool, rows.slice(0, 1), { minFeedFraction: 0.5 });
  assert.equal(r.deleteSkipped, true);
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int n FROM stations");
  assert.equal(n, 3);
});

test("an empty feed is refused", { skip }, async () => {
  await assert.rejects(upsertStations(pool, []), /empty/);
});
