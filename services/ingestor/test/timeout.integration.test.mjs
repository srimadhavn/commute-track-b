// A hung database call must fail (not hang forever) and the pool must recover afterwards.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const skip = process.env.TEST_PG !== "1" && "set TEST_PG=1 with PG* env vars to run";
const pool = new pg.Pool({ max: 2, connectionTimeoutMillis: 2000, query_timeout: 500 });
after(async () => { await pool.end(); });

test("query_timeout rejects a slow query and a discarded client is replaced", { skip }, async () => {
  const client = await pool.connect();
  await assert.rejects(client.query("SELECT pg_sleep(3)"), /timeout/i);
  client.release(true); // same thing store.mjs does after an error
  const { rows } = await pool.query("SELECT 1 AS ok");
  assert.equal(rows[0].ok, 1);
});
