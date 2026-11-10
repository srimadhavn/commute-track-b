// One JSON object per line on stdout (Loki-friendly). Never log request bodies or keys.
export const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: "api", msg, ...extra }));
