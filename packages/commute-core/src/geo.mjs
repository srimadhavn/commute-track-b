export function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nearest station that is renting and has bikes (live availability).
export function nearestStationWithBikes(point, stations, maxKm) {
  let best = null;
  for (const s of stations ?? []) {
    if (!s.is_renting || (s.bikes_available ?? 0) < 1) continue;
    const d = haversineKm(point, { lat: s.lat, lon: s.lon });
    if (d <= maxKm && (!best || d < best.distance_km)) best = { ...s, distance_km: d };
  }
  return best;
}
