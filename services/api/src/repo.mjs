// All SQL lives here. The API and tests talk to this interface, not to pg directly.
const COLS = `station_id, name, lat, lon, capacity, bikes_available, ebikes_available,
              docks_available, is_renting, last_reported::float8 AS last_reported`;

export function createRepo(pool) {
  return {
    async ping() {
      await pool.query("SELECT 1");
    },

    async summary() {
      const { rows: [r] } = await pool.query("SELECT count(*)::int AS count, max(updated_at) AS last_updated FROM stations");
      return { count: r.count, lastUpdated: r.last_updated };
    },

    async listStations(limit) {
      const { rows } = await pool.query(`SELECT ${COLS} FROM stations ORDER BY station_id LIMIT $1`, [limit]);
      return rows;
    },

    // PostGIS nearest-station query: stations that are renting and have a bike, within
    // radiusM metres of the point, nearest first (<-> uses the GiST index). Pre-filtering in SQL
    // means "limit" returns the nearest *usable* stations, not the nearest including empty ones.
    async nearbyStations(point, { radiusM, limit = 10 }) {
      const { rows } = await pool.query(
        `SELECT ${COLS}
           FROM stations
          WHERE is_renting AND bikes_available >= 1
            AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
          ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          LIMIT $4`,
        [point.lon, point.lat, radiusM, limit],
      );
      return rows;
    },
  };
}
