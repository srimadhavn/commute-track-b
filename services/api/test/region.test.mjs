import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "commute-core/src/routing.mjs";
import { getRegion, inRegion, biasedFetch } from "../src/region.mjs";
import { startApp, fakeRouter, post } from "./helpers.mjs";

const nyc = getRegion("nyc");
const repo = {
  summary: async () => ({ count: 1, lastUpdated: new Date() }),
  listStations: async () => [],
  nearbyStations: async () => [],
};

test("inRegion: NYC places in, other places out", () => {
  assert.ok(inRegion(nyc, { lat: 40.758, lon: -73.9855 }));   // Times Square
  assert.ok(inRegion(nyc, { lat: 40.6928, lon: -73.9903 }));  // Brooklyn
  assert.ok(inRegion(nyc, { lat: 40.7178, lon: -74.0431 }));  // Jersey City
  assert.ok(!inRegion(nyc, { lat: 43.65, lon: -79.38 }));     // Toronto
  assert.ok(!inRegion(nyc, { lat: 13.0827, lon: 80.2707 }));  // Chennai
});

test("getRegion rejects unknown ids with a helpful message", () => {
  assert.throws(() => getRegion("atlantis"), /Unknown REGION "atlantis".*nyc/);
});

// REAL responses captured from OpenRouteService on 2026-10-27 (first results, trimmed to what we use).
const feat = (layer, label, lon, lat) => ({ geometry: { coordinates: [lon, lat] }, properties: { layer, label } });
const ORS = {
  "Times Square, New York": [
    feat("street", "Times Square, Friendship, NY, USA", -78.143911, 42.176943),
    feat("street", "Times Square Road, Friendship, NY, USA", -78.145217, 42.176333),
    feat("street", "Times Square, Olean, NY, USA", -78.428856, 42.078024),
  ],
  "Times Square": [
    feat("venue", "Times Square Tower, New York, NY, USA", -73.986861, 40.755646),
    feat("street", "Times Square, Washington, NJ, USA", -74.056398, 40.986117),
    feat("street", "Times Square, Salisbury, MD, USA", -75.597925, 38.363969),
  ],
  "Chennai, India": [
    feat("locality", "Chennai, TN, India", 80.224741, 13.066682),
    feat("neighbourhood", "Chennai district, Chennai, TN, India", 80.213584, 13.148358),
  ],
  // Constructed: top hit is far away but an in-area candidate is further down the list.
  "Broadway": [
    feat("street", "Broadway, Buffalo, NY, USA", -78.83, 42.88),
    feat("street", "Broadway, Manhattan, New York, NY, USA", -73.9876, 40.7561),
  ],
};
// Stub standing in for api.openrouteservice.org: returns the captured response for the requested text.
const orsStub = (seen = []) => async (u) => {
  const url = new URL(String(u));
  seen.push(url);
  return { ok: true, status: 200, json: async () => ({ features: structuredClone(ORS[url.searchParams.get("text")] ?? []) }), text: async () => "" };
};
const realRouter = (seen) => createRouter({ apiKey: "dummy", fetchImpl: biasedFetch(nyc, orsStub(seen)) });

test("biasedFetch: soft bias + 10 candidates on geocode requests only, key and text preserved, NO hard boundary", async () => {
  const seen = [];
  const f = biasedFetch(nyc, async (u) => { seen.push(new URL(String(u))); return { ok: true, json: async () => ({ features: [] }) }; });
  await f("https://api.openrouteservice.org/geocode/search?api_key=K%2F1&text=Times%20Square&size=1");
  await f("https://api.openrouteservice.org/v2/directions/driving-car", { method: "POST" });
  const [g, d] = seen;
  assert.equal(g.searchParams.get("api_key"), "K/1");
  assert.equal(g.searchParams.get("text"), "Times Square");
  assert.equal(g.searchParams.get("focus.point.lat"), "40.758");
  assert.equal(g.searchParams.get("size"), "10");
  assert.ok([...g.searchParams.keys()].every((k) => !k.startsWith("boundary.")), "a hard boundary hides wrong matches");
  assert.equal(d.search, "", "directions URL must be untouched");
});

test("real ORS data: 'Times Square' resolves to the in-area venue", async () => {
  const p = await realRouter().geocode("Times Square");
  assert.match(p.label, /Times Square Tower/);
  assert.ok(inRegion(nyc, p));
});

test("an in-area candidate is promoted above a better-ranked far-away one", async () => {
  const p = await realRouter().geocode("Broadway");
  assert.match(p.label, /Manhattan/);
});

test("REGRESSION (real ORS data): 'Times Square, New York' resolves upstate -> 400 that says so", async () => {
  // ORS reads "New York" as the state. This is the 525 km bug from the first real run.
  const router = realRouter();
  let routeCalls = 0;
  const wrapped = { geocode: (t) => router.geocode(t), route: async () => { routeCalls++; return { distance_m: 1, duration_s: 1 }; } };
  const ctx = await startApp(repo, wrapped);
  try {
    const res = await post(ctx.base, "/plan-trip", { origin: "Times Square, New York", destination: "Times Square" });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /outside the supported area \(New York City area\)/);
    assert.match(body.error, /Friendship, NY/, "the message must say what it resolved to");
    assert.equal(routeCalls, 0, "no routing calls may be spent on an out-of-area request");
  } finally { await ctx.close(); }
});

test("REGRESSION (real ORS data): 'Chennai, India' is rejected as outside the area, never mapped to a NYC lookalike", async () => {
  const router = realRouter();
  const ctx = await startApp(repo, { geocode: (t) => router.geocode(t), route: async () => ({ distance_m: 1, duration_s: 1 }) });
  try {
    const res = await post(ctx.base, "/plan-trip", { origin: "Chennai, India", destination: "Times Square" });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /Chennai, TN, India/);
  } finally { await ctx.close(); }
});

test("coordinates outside the region are rejected with 400 and no ORS calls", async () => {
  const router = fakeRouter();
  const ctx = await startApp(repo, router);
  for (const [o, d] of [
    [{ lat: 13.0827, lon: 80.2707 }, { lat: 13.05, lon: 80.25 }],          // Chennai -> Chennai
    [{ lat: 40.758, lon: -73.9855 }, { lat: 43.65, lon: -79.38 }],         // NYC -> Toronto
  ]) {
    const res = await post(ctx.base, "/plan-trip", { origin: o, destination: d });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /outside the supported area/);
  }
  assert.equal(router.calls.route + router.calls.geocode, 0);
  await ctx.close();
});

test("an in-area trip still works end to end", async () => {
  const ctx = await startApp(repo, fakeRouter({ places: { "Times Square, New York": { lat: 40.758, lon: -73.9855 } } }));
  const res = await post(ctx.base, "/plan-trip", { origin: "Times Square, New York", destination: { lat: 40.6928, lon: -73.9903 } });
  assert.equal(res.status, 200);
  await ctx.close();
});
