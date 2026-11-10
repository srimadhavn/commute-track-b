import express from "express";
import { planTrip } from "./plan.mjs";
import { getRegion } from "./region.mjs";

const MAX_STATIONS = 5000;

export function createApp({ repo, router, metrics, log, corsOrigin = "*", staleAfterSec = 600, region = getRegion("nyc") }) {
  const app = express();
  app.disable("x-powered-by");

  // CORS: the shared React frontend is served from a different origin.
  app.use((req, res, next) => {
    res.set({
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    });
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Request metrics + access log. Route label is the matched pattern (never the raw URL).
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route?.path ?? "unmatched";
      metrics.http.observe({ method: req.method, route, status_code: res.statusCode }, seconds);
      if (route !== "/metrics" && route !== "/health") {
        log("info", "request", { method: req.method, route, status: res.statusCode, ms: Math.round(seconds * 1000) });
      }
    });
    next();
  });

  app.use(express.json({ limit: "10kb" }));

  app.get("/health", async (_req, res) => {
    try {
      const { count, lastUpdated } = await repo.summary();
      const ageSec = lastUpdated ? (Date.now() - new Date(lastUpdated).getTime()) / 1000 : null;
      const status = count === 0 ? "empty" : ageSec > staleAfterSec ? "stale" : "ok";
      res.json({ status, stations_last_updated: lastUpdated ? new Date(lastUpdated).toISOString() : null, station_count: count });
    } catch (err) {
      log("error", "health: db unreachable", { error: err.message });
      res.status(503).json({ status: "error", error: "database unreachable" });
    }
  });

  app.get("/stations", async (req, res, next) => {
    try {
      let limit = 3000;
      if (req.query.limit !== undefined) {
        limit = Number(req.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_STATIONS) {
          return res.status(400).json({ error: `limit must be an integer between 1 and ${MAX_STATIONS}` });
        }
      }
      const [stations, { count, lastUpdated }] = await Promise.all([repo.listStations(limit), repo.summary()]);
      res.json({
        retrieved_at: lastUpdated ? new Date(lastUpdated).toISOString() : new Date().toISOString(),
        station_count: count, // total in the database, regardless of limit
        stations,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/plan-trip", async (req, res, next) => {
    try {
      const { statusCode, body } = await planTrip(req.body, { router, repo, metrics, log, region });
      res.status(statusCode).json(body);
    } catch (err) {
      next(err);
    }
  });

  app.get("/metrics", async (_req, res, next) => {
    try {
      res.set("Content-Type", metrics.registry.contentType).send(await metrics.registry.metrics());
    } catch (err) {
      next(err);
    }
  });

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
      return res.status(400).json({ error: err.type === "entity.too.large" ? "Request body too large" : "Invalid JSON" });
    }
    log("error", "unhandled error", { error: err.message });
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}
