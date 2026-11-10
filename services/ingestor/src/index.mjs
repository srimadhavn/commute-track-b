import http from "node:http";
import pg from "pg";
import { loadConfig } from "./config.mjs";
import { log } from "./log.mjs";
import { fetchFeeds, mergeStations } from "./gbfs.mjs";
import { upsertStations } from "./store.mjs";
import { createMetrics } from "./metrics.mjs";
import { createIngestor } from "./ingestor.mjs";

const cfg = loadConfig();
const metrics = createMetrics();
const pool = new pg.Pool({ max: 3, connectionTimeoutMillis: 10000, query_timeout: 30000, keepAlive: true }); // connection settings come from PGHOST/PGUSER/PGPASSWORD/PGDATABASE
pool.on("error", (err) => log("error", "idle db client error", { error: err.message }));

const ingestor = createIngestor({
  fetchFeeds: () => fetchFeeds(cfg.gbfsBaseUrl, { timeoutMs: cfg.fetchTimeoutMs }),
  mergeStations,
  upsert: (rows) => upsertStations(pool, rows, { minFeedFraction: cfg.minFeedFraction }),
  metrics,
  log,
});

// /metrics for Prometheus (B2), /healthz for the Docker healthcheck.
const server = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.writeHead(200, { "content-type": metrics.registry.contentType });
    return res.end(await metrics.registry.metrics());
  }
  if (req.url === "/healthz") {
    const ok = ingestor.isHealthy(cfg.intervalSec);
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    return res.end(JSON.stringify({ status: ok ? "ok" : "unhealthy", last_error: ingestor.state.lastError }));
  }
  res.writeHead(404).end();
});
server.listen(cfg.metricsPort, () => log("info", "ingestor started", { interval_sec: cfg.intervalSec, gbfs: cfg.gbfsBaseUrl, metrics_port: cfg.metricsPort }));

// setTimeout chain (not setInterval) so cycles can never overlap.
let timer = null;
let stopping = false;
async function loop() {
  await ingestor.runOnce();
  if (!stopping) timer = setTimeout(loop, cfg.intervalSec * 1000);
}
loop();

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log("info", "shutting down", { signal });
  clearTimeout(timer);
  server.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
