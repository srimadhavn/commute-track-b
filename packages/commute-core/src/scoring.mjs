const r2 = (n) => Math.round(n * 100) / 100;

export function scoreOption(id, name, legs, config) {
  let time = 0, cost = 0, co2 = 0, dist = 0;
  for (const leg of legs) {
    const m = config.modes[leg.mode];
    if (!m) throw new Error(`Unknown mode: ${leg.mode}`);
    time += leg.duration_min;
    dist += leg.distance_km;
    cost += (m.flat_cost ?? 0) + (m.cost_per_km ?? 0) * leg.distance_km;
    co2 += m.co2_g_per_km * leg.distance_km;
  }
  return {
    id, name, legs,
    total_time_min: Math.round(time),
    total_distance_km: r2(dist),
    total_cost: r2(cost),
    total_co2_g: Math.round(co2),
    data_quality: legs.every((l) => l.source === "routing") ? "routed" : "estimated",
  };
}

const norm = (v, min, max) => (max === min ? 0 : (v - min) / (max - min));

export function rankOptions(options, config) {
  if (options.length === 0) return [];
  const col = (k) => options.map((o) => o[k]);
  const [tMin, tMax] = [Math.min(...col("total_time_min")), Math.max(...col("total_time_min"))];
  const [cMin, cMax] = [Math.min(...col("total_cost")), Math.max(...col("total_cost"))];
  const [gMin, gMax] = [Math.min(...col("total_co2_g")), Math.max(...col("total_co2_g"))];
  const car = options.find((o) => o.id === "car");
  const w = config.weights;

  const ranked = options.map((o) => {
    const score =
      norm(o.total_time_min, tMin, tMax) * w.time +
      norm(o.total_cost, cMin, cMax) * w.cost +
      norm(o.total_co2_g, gMin, gMax) * w.co2;
    const out = { ...o, composite_score: Number(score.toFixed(3)), tags: [] };
    if (car && o.id !== "car") {
      out.vs_car = {
        time_diff_min: o.total_time_min - car.total_time_min,
        cost_savings: r2(car.total_cost - o.total_cost),
        co2_savings_g: car.total_co2_g - o.total_co2_g,
      };
    }
    return out;
  });

  ranked.sort((a, b) => a.composite_score - b.composite_score);
  const tag = (key, label) => {
    const min = Math.min(...ranked.map((o) => o[key]));
    ranked.filter((o) => o[key] === min).forEach((o) => o.tags.push(label));
  };
  tag("total_time_min", "fastest");
  tag("total_cost", "cheapest");
  tag("total_co2_g", "greenest");
  ranked[0].tags.unshift("best_overall");
  return ranked;
}
