import { createApp } from "../src/app.mjs";
import { createMetrics } from "../src/metrics.mjs";

export const quiet = () => {};

// Stub for the OpenRouteService adapter: deterministic, no network.
export function fakeRouter({ failRoute = false, places = {} } = {}) {
  const calls = { route: 0, geocode: 0 };
  return {
    calls,
    async route() {
      calls.route++;
      if (failRoute) throw new Error("ORS 503: down");
      return { distance_m: 11000, duration_s: 1500 };
    },
    async geocode(text) {
      calls.geocode++;
      const p = places[text];
      if (!p) throw new Error(`Could not find location: ${text}`);
      return { label: text, ...p };
    },
  };
}

export async function startApp(repo, router, opts = {}) {
  const metrics = createMetrics({ repo, log: quiet });
  const app = createApp({ repo, router, metrics, log: quiet, ...opts });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, metrics, close: () => new Promise((r) => server.close(r)) };
}

export const post = (base, path, body, raw = false) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? body : JSON.stringify(body) });
