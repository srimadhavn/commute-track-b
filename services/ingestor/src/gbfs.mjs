// Fetch + normalise the two GBFS feeds. Pure functions where possible, so they are unit-testable.

export async function fetchJson(url, { timeoutMs = 15000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function fetchFeeds(baseUrl, opts) {
  const [info, status] = await Promise.all([
    fetchJson(`${baseUrl}/station_information.json`, opts),
    fetchJson(`${baseUrl}/station_status.json`, opts),
  ]);
  return { info, status };
}

const toInt = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : d;
};
// GBFS v1/v2 use 0/1, v3 uses booleans.
const toBool = (v) => v === true || v === 1 || v === "1" || v === "true";

// Join information (static: name, coords) with status (live: bikes, docks) by station_id.
// Stations with unusable coordinates are dropped and counted, never inserted.
export function mergeStations(info, status) {
  const infoList = info?.data?.stations;
  const statusList = status?.data?.stations;
  if (!Array.isArray(infoList) || !Array.isArray(statusList)) {
    throw new Error("Unexpected GBFS shape: data.stations missing");
  }
  const byId = new Map(statusList.map((s) => [String(s.station_id), s]));
  const rows = [];
  let dropped = 0;
  for (const i of infoList) {
    const lat = Number(i.lat), lon = Number(i.lon);
    const id = i.station_id == null ? "" : String(i.station_id);
    const name = typeof i.name === "string" ? i.name : (i.name?.[0]?.text ?? ""); // v3 names are localised arrays
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) {
      dropped++;
      continue;
    }
    const s = byId.get(id) ?? {};
    rows.push({
      station_id: id,
      name: name || id,
      lat, lon,
      capacity: i.capacity == null ? null : toInt(i.capacity),
      bikes_available: toInt(s.num_bikes_available),
      ebikes_available: toInt(s.num_ebikes_available),
      docks_available: toInt(s.num_docks_available),
      is_renting: toBool(s.is_renting),
      is_returning: toBool(s.is_returning),
      last_reported: s.last_reported == null ? null : toInt(s.last_reported, null),
    });
  }
  return { rows, dropped, feedLastUpdated: status.last_updated ?? null };
}
