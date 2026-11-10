const int = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : d);

export function loadConfig(env = process.env) {
  return {
    gbfsBaseUrl: (env.GBFS_BASE_URL ?? "https://gbfs.citibikenyc.com/gbfs/en").replace(/\/+$/, ""),
    intervalSec: int(env.INGEST_INTERVAL_SEC, 120),
    fetchTimeoutMs: int(env.FETCH_TIMEOUT_MS, 15000),
    metricsPort: int(env.METRICS_PORT, 9101),
    // Station rows are only deleted when the feed looks complete (>= this fraction of what we hold).
    minFeedFraction: int(env.MIN_FEED_FRACTION, 0.5),
  };
}
