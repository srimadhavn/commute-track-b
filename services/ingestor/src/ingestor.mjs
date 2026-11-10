// The ingest cycle, with its dependencies injected so it can be tested without network or DB.
export function createIngestor({ fetchFeeds, mergeStations, upsert, metrics, log, now = () => Date.now() }) {
  const state = { lastSuccessMs: null, lastError: null, running: false };

  async function runOnce() {
    if (state.running) return { skipped: true };
    state.running = true;
    const t0 = now();
    try {
      const { info, status } = await fetchFeeds();
      const { rows, dropped, feedLastUpdated } = mergeStations(info, status);
      const result = await upsert(rows);
      const seconds = (now() - t0) / 1000;
      state.lastSuccessMs = now();
      state.lastError = null;
      metrics.runs.inc({ result: "success" });
      metrics.duration.observe(seconds);
      metrics.stations.set(rows.length);
      metrics.dropped.set(dropped);
      metrics.lastSuccess.set(state.lastSuccessMs / 1000);
      if (feedLastUpdated) metrics.feedAge.set(Math.max(0, state.lastSuccessMs / 1000 - Number(feedLastUpdated)));
      log("info", "ingest ok", { stations: rows.length, dropped, ...result, seconds: Number(seconds.toFixed(2)) });
      if (result.deleteSkipped) log("warn", "feed looked truncated; stale stations NOT deleted");
      return { ok: true, ...result };
    } catch (err) {
      state.lastError = err.message;
      metrics.runs.inc({ result: "error" });
      log("error", "ingest failed", { error: err.message });
      return { ok: false, error: err.message };
    } finally {
      state.running = false;
    }
  }

  // Healthy = a success within 3 intervals (tolerates a couple of transient failures).
  const isHealthy = (intervalSec) =>
    state.lastSuccessMs !== null && now() - state.lastSuccessMs < intervalSec * 3 * 1000;

  return { runOnce, state, isHealthy };
}
