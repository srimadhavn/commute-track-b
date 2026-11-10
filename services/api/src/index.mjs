import pg from "pg";
import { createRouter } from "commute-core/src/routing.mjs";
import { createApp } from "./app.mjs";
import { getRegion, biasedFetch } from "./region.mjs";
import { createRepo } from "./repo.mjs";
import { createMetrics } from "./metrics.mjs";
import { log } from "./log.mjs";

if (!process.env.ORS_API_KEY) {
  log("error", "ORS_API_KEY is not set; put it in .env (never in code or chat)");
  process.exit(1);
}

const pool = new pg.Pool({ max: 10 }); // PGHOST/PGUSER/PGPASSWORD/PGDATABASE from the environment
pool.on("error", (err) => log("error", "idle db client error", { error: err.message }));

const repo = createRepo(pool);
const metrics = createMetrics({ repo, log });
const region = getRegion(process.env.REGION ?? "nyc");
const router = createRouter({ apiKey: process.env.ORS_API_KEY, fetchImpl: biasedFetch(region) });
const app = createApp({
  repo, router, metrics, log, region,
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  staleAfterSec: Number(process.env.STALE_AFTER_SEC ?? 600),
});

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => log("info", "api listening", { port, region: region.id }));

async function shutdown(signal) {
  log("info", "shutting down", { signal });
  server.close(async () => { await pool.end().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
