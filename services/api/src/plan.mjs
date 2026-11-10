import { handlePlanTrip } from "commute-core/src/handler.mjs";
import { CONFIG } from "commute-core/src/config.mjs";
import { inRegion } from "./region.mjs";

const isPoint = (p) => p && typeof p.lat === "number" && typeof p.lon === "number";

// Wraps (does not modify) commute-core's handler.
//  - the handler's getStations() takes no arguments, so we remember where the origin resolved to
//    (given as {lat,lon}, or captured when the router geocodes the origin text) and use PostGIS
//    to fetch only the stations near it, instead of loading every station.
//  - the router is wrapped to add metrics and logs, because the core swallows routing errors
//    (it falls back to estimates) and would otherwise hide ORS outages from monitoring.
export async function planTrip(body, { router, repo, metrics, log, region }) {
  // Coordinates given directly are checked here; geocoded text is checked in the router wrapper below.
  for (const key of ["origin", "destination"]) {
    if (isPoint(body?.[key]) && !inRegion(region, body[key])) {
      return { statusCode: 400, body: { error: `Location is outside the supported area (${region.name}): ${key}` } };
    }
  }

  let originPoint = isPoint(body?.origin) ? { lat: body.origin.lat, lon: body.origin.lon } : null;
  const originText = typeof body?.origin === "string" ? body.origin.trim() : null;

  async function observed(op, fn) {
    const end = metrics.orsDur.startTimer({ op });
    try {
      const out = await fn();
      metrics.orsReq.inc({ op, result: "ok" });
      return out;
    } catch (err) {
      metrics.orsReq.inc({ op, result: "error" });
      log("warn", "ors call failed", { op, error: err.message });
      throw err;
    } finally {
      end();
    }
  }

  const scopedRouter = {
    route: (profile, from, to) => observed("route", () => router.route(profile, from, to)),
    async geocode(text) {
      const p = await observed("geocode", () => router.geocode(text));
      // Not an ORS failure, so it is checked outside observed(). The "Location" prefix makes the core return 400.
      if (!inRegion(region, p)) {
        throw new Error(
          `Location is outside the supported area (${region.name}): "${text}" resolved to "${p.label}". ` +
          `Try the place name without the city, a more specific address, or coordinates.`);
      }
      if (originText !== null && text === originText) originPoint = { lat: p.lat, lon: p.lon };
      return p;
    },
  };

  const getStations = async () => {
    if (!originPoint) return [];
    try {
      return await repo.nearbyStations(originPoint, { radiusM: CONFIG.hybrid.max_station_km * 1000, limit: 10 });
    } catch (err) {
      metrics.stationQueryFailures.inc();
      log("error", "nearby station query failed", { error: err.message });
      throw err; // the core catches this and plans without live data
    }
  };

  const result = await handlePlanTrip(body, { router: scopedRouter, getStations });
  if (result.statusCode === 200) metrics.planLive.inc({ used: String(result.body.live_bike_data_used) });
  if (result.statusCode === 500) log("error", "plan-trip returned 500");
  return result;
}
