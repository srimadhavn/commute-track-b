import client from "prom-client";

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: "ingestor_" });
  const m = {
    registry,
    runs: new client.Counter({ name: "ingest_runs_total", help: "Ingest cycles by result", labelNames: ["result"], registers: [registry] }),
    duration: new client.Histogram({ name: "ingest_duration_seconds", help: "Duration of successful ingest cycles", buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30], registers: [registry] }),
    stations: new client.Gauge({ name: "ingest_stations", help: "Stations written in the last successful run", registers: [registry] }),
    dropped: new client.Gauge({ name: "ingest_stations_dropped", help: "Stations skipped (bad coordinates) in the last run", registers: [registry] }),
    lastSuccess: new client.Gauge({ name: "ingest_last_success_timestamp_seconds", help: "Unix time of last successful ingest", registers: [registry] }),
    feedAge: new client.Gauge({ name: "ingest_feed_age_seconds", help: "Age of the upstream GBFS feed at ingest time", registers: [registry] }),
  };
  m.runs.inc({ result: "success" }, 0);
  m.runs.inc({ result: "error" }, 0);
  return m;
}
