import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeStations, fetchJson } from "../src/gbfs.mjs";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
const info = fx("station_information"), status = fx("station_status");

test("mergeStations joins info and status by station_id", () => {
  const { rows } = mergeStations(info, status);
  const a1 = rows.find((r) => r.station_id === "a1");
  assert.deepEqual(
    { b: a1.bikes_available, e: a1.ebikes_available, d: a1.docks_available, r: a1.is_renting, lr: a1.last_reported },
    { b: 7, e: 2, d: 33, r: true, lr: 1789047552 },
  );
  assert.equal(rows.find((r) => r.station_id === "a2").is_renting, false);
});

test("mergeStations drops bad coordinates and missing ids, and counts them", () => {
  const { rows, dropped } = mergeStations(info, status);
  assert.equal(dropped, 2);
  assert.deepEqual(rows.map((r) => r.station_id).sort(), ["a1", "a2", "a4"]);
});

test("a station with no status row gets safe defaults (not renting, zero bikes)", () => {
  const a4 = mergeStations(info, status).rows.find((r) => r.station_id === "a4");
  assert.equal(a4.bikes_available, 0);
  assert.equal(a4.is_renting, false);
  assert.equal(a4.last_reported, null);
});

test("accepts GBFS v3 booleans and localised names", () => {
  const i = { data: { stations: [{ station_id: "x", name: [{ text: "Pier 1", language: "en" }], lat: 40.7, lon: -74 }] } };
  const s = { data: { stations: [{ station_id: "x", num_bikes_available: 3, is_renting: true }] } };
  const [r] = mergeStations(i, s).rows;
  assert.equal(r.name, "Pier 1");
  assert.equal(r.is_renting, true);
});

test("rejects an unexpected feed shape", () => {
  assert.throws(() => mergeStations({ data: {} }, status), /Unexpected GBFS shape/);
});

test("fetchJson throws on non-200", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(fetchJson("http://x/y", { fetchImpl }), /HTTP 503/);
});
