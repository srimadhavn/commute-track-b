// OpenRouteService adapter (free tier, no card). fetch is injectable for tests.
export function createRouter({ apiKey, fetchImpl = fetch, timeoutMs = 8000, baseUrl = "https://api.openrouteservice.org" }) {
  if (!apiKey) throw new Error("ORS api key is required");

  async function call(url, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ORS ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    // profile: driving-car | cycling-regular | foot-walking
    async route(profile, from, to) {
      const data = await call(`${baseUrl}/v2/directions/${profile}`, {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [[from.lon, from.lat], [to.lon, to.lat]] }),
      });
      const s = data?.routes?.[0]?.summary;
      if (!s) throw new Error("ORS returned no route");
      return { distance_m: s.distance, duration_s: s.duration };
    },
    async geocode(text) {
      const url = `${baseUrl}/geocode/search?api_key=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(text)}&size=1`;
      const data = await call(url);
      const f = data?.features?.[0];
      if (!f) throw new Error(`Could not find location: ${text}`);
      const [lon, lat] = f.geometry.coordinates;
      return { lat, lon, label: f.properties?.label ?? text };
    },
  };
}
