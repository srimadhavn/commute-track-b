import client from "prom-client";

export function createMetrics({ repo, log }) {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: "api_" });

  const m = {
    registry,
    http: new client.Histogram({
      name: "http_request_duration_seconds", help: "HTTP request latency",
      labelNames: ["method", "route", "status_code"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [registry],
    }),
    planLive: new client.Counter({
      name: "plan_trip_live_data_total", help: "Successful plan-trip responses by whether live bike data was used",
      labelNames: ["used"], registers: [registry],
    }),
    orsReq: new client.Counter({
      name: "ors_requests_total", help: "OpenRouteService calls by operation and result",
      labelNames: ["op", "result"], registers: [registry],
    }),
    orsDur: new client.Histogram({
      name: "ors_request_duration_seconds", help: "OpenRouteService call latency",
      labelNames: ["op"], buckets: [0.1, 0.25, 0.5, 1, 2, 4, 8], registers: [registry],
    }),
    stationQueryFailures: new client.Counter({
      name: "station_query_failures_total", help: "Failed station lookups during plan-trip (falls back to no live data)", registers: [registry],
    }),
  };

  // Computed at scrape time, so they are always current.
  async function readSummary() {
    try { return await repo.summary(); } catch (err) { log("warn", "metrics: summary query failed", { error: err.message }); return null; }
  }
  new client.Gauge({
    name: "stations_count", help: "Stations currently in the database", registers: [registry],
    async collect() { const s = await readSummary(); if (s) this.set(s.count); },
  });
  new client.Gauge({
    name: "stations_age_seconds", help: "Seconds since the ingestor last wrote station data", registers: [registry],
    async collect() { const s = await readSummary(); if (s?.lastUpdated) this.set((Date.now() - new Date(s.lastUpdated).getTime()) / 1000); },
  });

  for (const used of ["true", "false"]) m.planLive.inc({ used }, 0);
  return m;
}
