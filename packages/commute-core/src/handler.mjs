import { planTrip } from "./planner.mjs";

// Platform-neutral request handler. Track A wraps it in a Lambda, Track B in Express.
// deps: { router, getStations: async () => station[] }
const validPoint = (p) =>
  p && typeof p.lat === "number" && typeof p.lon === "number" &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

async function resolve(input, router) {
  if (typeof input === "string") {
    if (input.trim().length < 2 || input.length > 200) throw new Error("Invalid location text");
    return router.geocode(input.trim());
  }
  if (validPoint(input)) return { lat: input.lat, lon: input.lon };
  throw new Error("Location must be text or {lat, lon}");
}

export async function handlePlanTrip(body, { router, getStations }) {
  try {
    if (!body || body.origin == null || body.destination == null) {
      return { statusCode: 400, body: { error: "origin and destination are required" } };
    }
    const [origin, destination] = await Promise.all([resolve(body.origin, router), resolve(body.destination, router)]);
    const stations = await getStations().catch(() => []);
    const result = await planTrip({ origin, destination, stations, router });
    return { statusCode: 200, body: { origin, destination, ...result } };
  } catch (err) {
    const client = /Location|Could not find|required|Invalid location/.test(err.message);
    return { statusCode: client ? 400 : 500, body: { error: client ? err.message : "Internal error" } };
  }
}
