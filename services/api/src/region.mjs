// Service area ("region profile"). The core has no notion of geography, so the API layer owns it:
//  1. geocoding is biased toward the region (otherwise "Times Square" can resolve to another continent)
//  2. any location outside the region is rejected with a 400 instead of planning a nonsense trip
// A new city (e.g. Chennai) is a new entry here plus its values in the core's config.mjs.
export const REGIONS = {
  nyc: {
    id: "nyc",
    name: "New York City area",
    // Generous box: five boroughs + Jersey City/Hoboken/Newark side (Citi Bike also serves Jersey City/Hoboken).
    bbox: { min_lon: -74.3, min_lat: 40.45, max_lon: -73.65, max_lat: 40.95 },
    focus: { lat: 40.758, lon: -73.9855 },
  },
};

export function getRegion(id = "nyc") {
  const r = REGIONS[id];
  if (!r) throw new Error(`Unknown REGION "${id}". Known: ${Object.keys(REGIONS).join(", ")}`);
  return r;
}

export const inRegion = (region, p) =>
  p.lat >= region.bbox.min_lat && p.lat <= region.bbox.max_lat &&
  p.lon >= region.bbox.min_lon && p.lon <= region.bbox.max_lon;

// Wraps fetch so the core's ORS adapter (which we do not modify) sends region-biased geocode requests.
// Only /geocode/search URLs are touched; directions calls pass through unchanged.
//  - SOFT bias only (focus.point): a hard boundary makes the geocoder return fuzzy in-box matches for places that
//    are not in the region ("Chennai, India" became "Chennai Garden, New York"), hiding the real problem.
//  - Ask for several candidates and put any in-region one first, because the core only reads the first feature.
//    If nothing is in-region the original first result stays first and the caller rejects it clearly.
const CANDIDATES = 10;

export function biasedFetch(region, baseFetch = fetch) {
  return async (url, init) => {
    const u = new URL(String(url));
    if (!u.pathname.endsWith("/geocode/search")) return baseFetch(u, init);

    u.searchParams.set("focus.point.lon", String(region.focus.lon));
    u.searchParams.set("focus.point.lat", String(region.focus.lat));
    u.searchParams.set("size", String(CANDIDATES));
    const res = await baseFetch(u, init);
    if (!res.ok) return res;

    const data = await res.json();
    if (Array.isArray(data?.features)) {
      const inside = [], outside = [];
      for (const f of data.features) {
        const [lon, lat] = f?.geometry?.coordinates ?? [];
        (Number.isFinite(lat) && Number.isFinite(lon) && inRegion(region, { lat, lon }) ? inside : outside).push(f);
      }
      data.features = [...inside, ...outside];
    }
    return { ok: true, status: res.status, json: async () => data, text: async () => JSON.stringify(data) };
  };
}
