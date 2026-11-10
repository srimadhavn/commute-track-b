-- Runs once, on first start of an EMPTY data volume (docker-entrypoint-initdb.d).
-- To re-run after editing: docker compose down -v   (this deletes the DB volume)
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS stations (
  station_id      text PRIMARY KEY,
  name            text NOT NULL,
  lat             double precision NOT NULL,
  lon             double precision NOT NULL,
  geom            geography(Point, 4326) NOT NULL,
  capacity        integer,
  bikes_available  integer NOT NULL DEFAULT 0,
  ebikes_available integer NOT NULL DEFAULT 0,
  docks_available  integer NOT NULL DEFAULT 0,
  is_renting      boolean NOT NULL DEFAULT false,
  is_returning    boolean NOT NULL DEFAULT false,
  last_reported   bigint,                       -- unix seconds, from the feed
  updated_at      timestamptz NOT NULL DEFAULT now()  -- when WE last ingested it
);

-- Nearest-station queries (ST_DWithin / <->) use this index.
CREATE INDEX IF NOT EXISTS stations_geom_gix ON stations USING gist (geom);
