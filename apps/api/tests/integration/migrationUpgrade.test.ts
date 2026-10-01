import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/runMigrations";
import { migrationsFolder, resetDatabase, wipeTestDatabase } from "../support/resetDatabase";
import { testDatabaseUrl } from "../support/testEnvironment";

interface Journal {
  entries: { idx: number; when: number; tag: string }[];
}

const journal: Journal = JSON.parse(
  readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
);

/** A migrations folder holding only the first release's migration. */
function firstReleaseFolder(): string {
  const [first] = journal.entries;
  if (first === undefined) throw new Error("no migrations in the journal");
  const folder = mkdtempSync(join(tmpdir(), "trail-migrations-"));
  mkdirSync(join(folder, "meta"));
  cpSync(join(migrationsFolder, `${first.tag}.sql`), join(folder, `${first.tag}.sql`));
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: [first] }),
  );
  return folder;
}

/** Every table that holds recorded data, with a fingerprint of its rows. */
const fingerprint = `
  SELECT
    (SELECT count(*) FROM locations)::int AS locations,
    (SELECT round(sum(lat * 1e6 + lon)::numeric, 3)::text FROM locations) AS location_sum,
    (SELECT min(recorded_at)::text || '…' || max(recorded_at)::text FROM locations) AS location_span,
    (SELECT count(*) FROM visits)::int AS visits,
    (SELECT count(*) FROM trips)::int AS trips,
    (SELECT count(*) FROM device_events)::int AS events,
    (SELECT count(*) FROM ingest_rejects)::int AS rejects,
    (SELECT count(*) FROM devices)::int AS devices,
    (SELECT count(*) FROM users)::int AS users
`;

/*
 * Deployed databases are never rebuilt: every release migrates the data that is
 * already there. This test starts from the first release's schema, records data
 * the way that release did, applies every later migration and checks that not a
 * row changed — so a migration that would lose or break existing data fails CI
 * instead of a home server.
 */
describe("migrations on an existing database", () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  let folder = "";
  let before: Record<string, unknown> = {};

  beforeAll(async () => {
    await wipeTestDatabase(pool);
    folder = firstReleaseFolder();
    await runMigrations(pool, folder);

    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, webauthn_user_id, timezone)
       VALUES ('upgrade@example.com', 'Upgrade', '\\x0102', 'Europe/Brussels') RETURNING id`,
    );
    const device = await pool.query<{ id: string }>(
      `INSERT INTO devices (user_id, name, device_key, token_hash, token_hint, pending_settings)
       VALUES ($1, 'iPhone', 'iphone-upgrade', 'upgrade-token-hash', 'abcd', 'battery-saver')
       RETURNING id`,
      [user.rows[0]?.id],
    );
    const deviceId = device.rows[0]?.id;
    await pool.query(
      `INSERT INTO locations (device_id, recorded_at, lat, lon, horizontal_accuracy, motion)
       SELECT $1, timestamptz '2026-01-01T00:00:00Z' + n * interval '1 minute',
              51.05 + n * 0.0001, 3.72 - n * 0.0001, 10, ARRAY['walking']
       FROM generate_series(0, 499) AS n`,
      [deviceId],
    );
    await pool.query(
      `INSERT INTO visits (device_id, recorded_at, arrived_at, lat, lon)
       VALUES ($1, '2026-01-01T10:00:00Z', '2026-01-01T09:55:00Z', 51.05, 3.72)`,
      [deviceId],
    );
    await pool.query(
      `INSERT INTO trips (device_id, started_at, ended_at, mode, distance_m)
       VALUES ($1, '2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z', 'bicycle', 12345)`,
      [deviceId],
    );
    await pool.query(
      `INSERT INTO device_events (device_id, recorded_at, action)
       VALUES ($1, '2026-01-01T07:00:00Z', 'did_enter_background')`,
      [deviceId],
    );
    await pool.query(
      `INSERT INTO ingest_rejects (device_id, reason, record)
       VALUES ($1, 'unparseable timestamp', '{"timestamp": "yesterday"}')`,
      [deviceId],
    );
    before = (await pool.query(fingerprint)).rows[0] ?? {};

    await runMigrations(pool, migrationsFolder);
  });

  afterAll(async () => {
    rmSync(folder, { recursive: true, force: true });
    await pool.end();
    // leave the database as every other test file expects it
    await resetDatabase();
  });

  it("keeps every recorded row", async () => {
    expect(before["locations"]).toBe(500);
    expect((await pool.query(fingerprint)).rows[0]).toEqual(before);
  });

  it("applies every migration of the journal", async () => {
    const applied = await pool.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(applied.rows[0]?.count).toBe(journal.entries.length);
  });

  it("keeps settings stored by the first release", async () => {
    const device = await pool.query(
      "SELECT pending_settings FROM devices WHERE device_key = 'iphone-upgrade'",
    );
    expect(device.rows[0]?.pending_settings).toBe("battery-saver");
  });
});
