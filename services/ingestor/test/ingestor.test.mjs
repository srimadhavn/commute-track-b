import { test } from "node:test";
import assert from "node:assert/strict";
import { createIngestor } from "../src/ingestor.mjs";
import { createMetrics } from "../src/metrics.mjs";

const quiet = () => {};
function make(overrides = {}) {
  const metrics = createMetrics();
  let t = 1_000_000;
  const ing = createIngestor({
    fetchFeeds: async () => ({ info: {}, status: {} }),
    mergeStations: () => ({ rows: [{ station_id: "a" }], dropped: 1, feedLastUpdated: 999 }),
    upsert: async (rows) => ({ upserted: rows.length, deleted: 0, deleteSkipped: false }),
    metrics, log: quiet, now: () => t,
    ...overrides,
  });
  return { ing, metrics, advance: (ms) => (t += ms) };
}

test("a successful run updates state and metrics", async () => {
  const { ing, metrics } = make();
  const r = await ing.runOnce();
  assert.equal(r.ok, true);
  assert.equal(ing.isHealthy(120), true);
  const text = await metrics.registry.metrics();
  assert.match(text, /ingest_runs_total\{result="success"\} 1/);
  assert.match(text, /ingest_stations 1/);
});

test("a failed run is reported, never throws, and is counted", async () => {
  const { ing, metrics } = make({ upsert: async () => { throw new Error("db down"); } });
  const r = await ing.runOnce();
  assert.deepEqual(r, { ok: false, error: "db down" });
  assert.equal(ing.isHealthy(120), false);
  assert.match(await metrics.registry.metrics(), /ingest_runs_total\{result="error"\} 1/);
});

test("health tolerates a transient failure but not 3 missed intervals", async () => {
  const { ing, advance } = make();
  await ing.runOnce();
  advance(2 * 120 * 1000);
  assert.equal(ing.isHealthy(120), true);
  advance(2 * 120 * 1000);
  assert.equal(ing.isHealthy(120), false);
});

test("overlapping runs are skipped", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { ing } = make({ fetchFeeds: async () => { await gate; return { info: {}, status: {} }; } });
  const first = ing.runOnce();
  assert.deepEqual(await ing.runOnce(), { skipped: true });
  release();
  await first;
});
