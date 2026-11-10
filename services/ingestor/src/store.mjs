// Bulk upsert via unnest(): one round-trip for ~2,500 stations instead of 2,500 INSERTs.
const UPSERT = `
INSERT INTO stations
  (station_id, name, lat, lon, geom, capacity, bikes_available, ebikes_available,
   docks_available, is_renting, is_returning, last_reported, updated_at)
SELECT id, nm, la, lo, ST_SetSRID(ST_MakePoint(lo, la), 4326)::geography,
       cap, b, eb, d, rent, ret, lr, now()
FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::int[], $6::int[], $7::int[],
            $8::int[], $9::bool[], $10::bool[], $11::bigint[])
     AS t(id, nm, la, lo, cap, b, eb, d, rent, ret, lr)
ON CONFLICT (station_id) DO UPDATE SET
  name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon, geom = EXCLUDED.geom,
  capacity = EXCLUDED.capacity, bikes_available = EXCLUDED.bikes_available,
  ebikes_available = EXCLUDED.ebikes_available, docks_available = EXCLUDED.docks_available,
  is_renting = EXCLUDED.is_renting, is_returning = EXCLUDED.is_returning,
  last_reported = EXCLUDED.last_reported, updated_at = now()`;

const col = (rows, k) => rows.map((r) => r[k]);

export async function upsertStations(pool, rows, { minFeedFraction = 0.5 } = {}) {
  if (rows.length === 0) throw new Error("Refusing to ingest an empty station list");
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    await client.query(UPSERT, [
      col(rows, "station_id"), col(rows, "name"), col(rows, "lat"), col(rows, "lon"),
      col(rows, "capacity"), col(rows, "bikes_available"), col(rows, "ebikes_available"),
      col(rows, "docks_available"), col(rows, "is_renting"), col(rows, "is_returning"),
      col(rows, "last_reported"),
    ]);
    // Remove stations that left the feed, but only if the feed looks complete:
    // a truncated response must not wipe the table.
    const { rows: [{ n }] } = await client.query("SELECT count(*)::int AS n FROM stations");
    const stale = n - rows.length;
    let deleted = 0;
    let deleteSkipped = false;
    if (stale > 0) {
      if (rows.length >= n * minFeedFraction) {
        const r = await client.query("DELETE FROM stations WHERE station_id <> ALL($1::text[])", [col(rows, "station_id")]);
        deleted = r.rowCount;
      } else {
        deleteSkipped = true;
      }
    }
    await client.query("COMMIT");
    return { upserted: rows.length, deleted, deleteSkipped };
  } catch (err) {
    broken = true; // after any error (incl. a timeout) discard this connection instead of reusing it
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release(broken);
  }
}
