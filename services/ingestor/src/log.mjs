// One JSON object per line on stdout: easy for Loki/Promtail to parse later.
export const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: "ingestor", msg, ...extra }));
