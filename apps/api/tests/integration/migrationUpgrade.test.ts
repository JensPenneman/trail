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

/** A migrations folder holding the migrations up to and including `tag` (the first: the first release's). */
function folderUpTo(tag?: string): string {
  const last = tag === undefined ? 0 : journal.entries.findIndex((entry) => entry.tag === tag);
  if (last < 0 || journal.entries.length === 0)
    throw new Error(`no migration ${tag} in the journal`);
  const entries = journal.entries.slice(0, last + 1);
  const folder = mkdtempSync(join(tmpdir(), "trail-migrations-"));
  mkdirSync(join(folder, "meta"));
  for (const entry of entries) {
    cpSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  return folder;
}

/** The tag of the migration named `name` (`0002_api_tokens`): numbers change on rebases, names do not. */
function tagOf(name: string): string {
  const tag = journal.entries.find((entry) => entry.tag.endsWith(`_${name}`))?.tag;
  if (tag === undefined) throw new Error(`no migration named ${name} in the journal`);
  return tag;
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

/**
 * Tables of user data that a later migration created: once that migration has
 * run, rows are recorded in them and fingerprinted like the first release's
 * data, and every migration after it must keep them. Derived tables
 * (processed points, segments, the map cache, the queue) are rebuilt from
 * the recorded data instead.
 */
const laterTables: {
  migration: string;
  record: (pool: pg.Pool, ids: { userId: string; deviceId: string }) => Promise<void>;
  fingerprint: string;
}[] = [
  {
    // API tokens: every column of every row.
    migration: tagOf("api_tokens"),
    record: async (pool, { userId, deviceId }) => {
      await pool.query(
        `INSERT INTO api_tokens (user_id, name, token_hash, token_hint, scopes, device_ids,
           allowed_ips, expires_at, last_used_at, last_used_ip)
         VALUES ($1, 'Home Assistant', 'upgrade-api-token-hash', 'Wx9z',
           ARRAY['devices:read', 'locations:read'], ARRAY[$2::uuid], ARRAY['192.168.1.0/24'::cidr],
           '2027-01-01T00:00:00Z', '2026-01-02T10:00:00Z', '192.168.1.20')`,
        [userId, deviceId],
      );
      await pool.query(
        `INSERT INTO api_tokens (user_id, name, token_hash, token_hint, scopes, revoked_at)
         VALUES ($1, 'Old script', 'upgrade-revoked-token-hash', 'Ab12', ARRAY['history:read'],
           '2026-01-03T00:00:00Z')`,
        [userId],
      );
    },
    fingerprint: `
      SELECT count(*)::int AS rows,
        string_agg(
          concat_ws('|', id, user_id, name, token_hash, token_hint, scopes::text, device_ids::text,
            allowed_ips::text, expires_at::text, created_at::text, last_used_at::text,
            last_used_ip::text, revoked_at::text),
          ' / ' ORDER BY id
        ) AS digest
      FROM api_tokens
    `,
  },
  {
    migration: tagOf("processing"),
    record: async (pool, { userId, deviceId }) => {
      await pool.query(
        `INSERT INTO mode_overrides (device_id, kind, from_at, to_at, mode, source, created_by, created_at, revoked_at)
         VALUES ($1, 'segment', '2026-01-01T08:00:00Z', '2026-01-01T08:40:00Z', 'train', 'ui', $2, '2026-01-02T09:00:00Z', NULL),
                ($1, 'toggle', '2026-01-01T17:00:00Z', NULL, 'cycling', 'api', $2, '2026-01-01T17:00:00Z', NULL),
                ($1, 'toggle', '2026-01-01T18:00:00Z', '2026-01-01T18:30:00Z', 'bus', 'mcp', NULL, '2026-01-01T18:00:00Z', '2026-01-01T18:10:00Z')`,
        [deviceId, userId],
      );
    },
    fingerprint: `
      SELECT count(*)::int AS rows,
        md5(string_agg(concat_ws('|', device_id, kind, from_at, to_at, mode, source, created_by, created_at, revoked_at), ',' ORDER BY created_at, kind)) AS digest
      FROM mode_overrides
    `,
  },
  {
    // Sharing: who shares what with whom (Ana has an account, the second address not yet),
    // a public link, the grid key and Ana hiding the owner.
    migration: tagOf("sharing"),
    record: async (pool, { userId, deviceId }) => {
      await pool.query(
        `INSERT INTO shares (owner_user_id, recipient_email, recipient_user_id, device_ids,
           precision, history_days, include_details, expires_at, hidden_at)
         VALUES ($1, 'ana@example.com', (SELECT id FROM users WHERE email = 'ana@example.com'),
           ARRAY[$2]::uuid[], 'precise', 7, true, '2027-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
           ($1, 'pending@example.com', NULL, NULL, 'area', NULL, false, NULL, NULL)`,
        [userId, deviceId],
      );
      await pool.query(
        `INSERT INTO share_links (owner_user_id, token_hash, label, precision, expires_at, view_count)
         VALUES ($1, 'link-token-hash', 'Upgrade', 'approximate', '2026-02-01T00:00:00Z', 3)`,
        [userId],
      );
      await pool.query(
        `INSERT INTO server_secrets (name, secret) VALUES ('share-grid', decode(repeat('ab', 32), 'hex'))`,
      );
      await pool.query(
        `INSERT INTO hidden_people (user_id, hidden_user_id, hidden_at)
         VALUES ((SELECT id FROM users WHERE email = 'ana@example.com'), $1, '2026-02-01T00:00:00Z')`,
        [userId],
      );
    },
    fingerprint: `
      SELECT
        ((SELECT count(*) FROM shares) + (SELECT count(*) FROM share_links)
          + (SELECT count(*) FROM server_secrets WHERE name = 'share-grid')
          + (SELECT count(*) FROM hidden_people))::int AS rows,
        (SELECT string_agg(concat_ws('|', owner_user_id, recipient_email, recipient_user_id,
          device_ids::text, precision, history_days, include_details, expires_at, revoked_at,
          hidden_at), ';' ORDER BY id) FROM shares) AS share_rows,
        (SELECT string_agg(concat_ws('|', owner_user_id, token_hash, label, precision, history_days,
          expires_at, view_count), ';' ORDER BY id) FROM share_links) AS link_rows,
        (SELECT encode(secret, 'hex') FROM server_secrets WHERE name = 'share-grid') AS grid_key,
        (SELECT string_agg(concat_ws('|', user_id, hidden_user_id, hidden_at), ';' ORDER BY user_id)
          FROM hidden_people) AS hidden_people
    `,
  },
  {
    // Preferences: what the first account set; the accounts that set nothing hold `{}`.
    migration: tagOf("preferences"),
    record: async (pool, { userId }) => {
      await pool.query(
        `UPDATE users SET preferences = '{"mapStyle": "satellite", "level": "raw", "showOwnActivity": true}'
         WHERE id = $1`,
        [userId],
      );
    },
    fingerprint: `
      SELECT count(*)::int AS rows,
        string_agg(
          concat_ws('|', id, email, display_name, webauthn_user_id::text, is_admin, timezone,
            preferences::text, created_at::text),
          ' / ' ORDER BY email
        ) AS digest
      FROM users
    `,
  },
  {
    // The data access log: a person's look, a link visitor's and a token's, and the visitor key.
    migration: tagOf("data_access_log"),
    record: async (pool, { userId, deviceId }) => {
      await pool.query(
        `INSERT INTO data_access_events (owner_user_id, bucket_start, first_at, last_at, count,
           actor_kind, channel, actor_user_id, actor_share_id, actor_label, action, access, resource,
           status, dedupe_key)
         VALUES ($1, '2026-02-01T09:00:00Z', '2026-02-01T09:05:00Z', '2026-02-01T09:55:00Z', 14,
           'person', 'live', (SELECT id FROM users WHERE email = 'ana@example.com'),
           (SELECT id FROM shares WHERE recipient_email = 'ana@example.com'), 'Ana',
           'live.position', 'read', jsonb_build_object('deviceIds', jsonb_build_array($2::text),
             'precision', 'precise'), 200, repeat('a', 43))`,
        [userId, deviceId],
      );
      await pool.query(
        `INSERT INTO data_access_events (owner_user_id, bucket_start, first_at, last_at, count,
           actor_kind, channel, actor_link_id, actor_label, visitor_key, ip_coarse, ua_family,
           action, access, resource, status, dedupe_key)
         VALUES ($1, '2026-02-01T10:00:00Z', '2026-02-01T10:01:00Z', '2026-02-01T10:02:00Z', 3,
           'link', 'link', (SELECT id FROM share_links WHERE label = 'Upgrade'), 'Upgrade',
           '0123456789abcdef', '81.82.83.0/24', 'iPhone · Safari', 'link.view', 'read',
           '{"precision": "approximate"}', 200, repeat('b', 43))`,
        [userId],
      );
      await pool.query(
        `INSERT INTO data_access_events (owner_user_id, bucket_start, first_at, last_at, count,
           actor_kind, channel, actor_token_id, actor_label, action, access, resource, status,
           dedupe_key)
         VALUES ($1, '2026-02-01T11:00:00Z', '2026-02-01T11:00:00Z', '2026-02-01T11:00:00Z', 1,
           'token', 'api', (SELECT id FROM api_tokens WHERE name = 'Home Assistant'),
           'Home Assistant', 'getTracks', 'read', '{"level": "inferred"}', 200, repeat('c', 43))`,
        [userId],
      );
      await pool.query(
        `INSERT INTO server_secrets (name, secret) VALUES ('data-access-visitor', decode(repeat('cd', 32), 'hex'))`,
      );
    },
    fingerprint: `
      SELECT
        ((SELECT count(*) FROM data_access_events)
          + (SELECT count(*) FROM server_secrets WHERE name = 'data-access-visitor'))::int AS rows,
        (SELECT string_agg(concat_ws('|', owner_user_id, bucket_start, first_at, last_at, count,
          actor_kind, channel, actor_user_id, actor_session_id, actor_token_id, actor_share_id,
          actor_link_id, actor_label, visitor_key, ip_coarse, ua_family, action, access,
          resource::text, status, dedupe_key), ';' ORDER BY id) FROM data_access_events) AS events,
        (SELECT encode(secret, 'hex') FROM server_secrets WHERE name = 'data-access-visitor')
          AS visitor_key
    `,
  },
];

/*
 * Deployed databases are never rebuilt: every release migrates the data that is
 * already there. This test starts from the first release's schema, records data
 * the way that release did, applies every later migration and checks that not a
 * row changed — so a migration that would lose or break existing data fails CI
 * instead of a home server.
 */
describe("migrations on an existing database", () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  const folders: string[] = [];
  let before: Record<string, unknown> = {};
  const laterBefore = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    await wipeTestDatabase(pool);
    const firstRelease = folderUpTo();
    folders.push(firstRelease);
    await runMigrations(pool, firstRelease);

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
    // Someone to share with, of the first release: their account is part of its data.
    await pool.query(
      `INSERT INTO users (email, display_name, webauthn_user_id, timezone)
       VALUES ('ana@example.com', 'Ana', '\\x0304', 'Europe/Brussels')`,
    );
    before = (await pool.query(fingerprint)).rows[0] ?? {};

    for (const later of laterTables) {
      const folder = folderUpTo(later.migration);
      folders.push(folder);
      await runMigrations(pool, folder);
      await later.record(pool, { userId: user.rows[0]?.id ?? "", deviceId: deviceId ?? "" });
      laterBefore.set(later.migration, (await pool.query(later.fingerprint)).rows[0] ?? {});
    }

    await runMigrations(pool, migrationsFolder);
  });

  afterAll(async () => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
    await pool.end();
    // leave the database as every other test file expects it
    await resetDatabase();
  });

  it("keeps every recorded row", async () => {
    expect(before["locations"]).toBe(500);
    expect((await pool.query(fingerprint)).rows[0]).toEqual(before);
  });

  it("keeps the rows of tables added after the first release", async () => {
    for (const later of laterTables) {
      const recorded = laterBefore.get(later.migration);
      expect(recorded?.["rows"]).toBeGreaterThan(0);
      expect((await pool.query(later.fingerprint)).rows[0]).toEqual(recorded);
    }
  });

  it("applies every migration of the journal", async () => {
    const applied = await pool.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(applied.rows[0]?.count).toBe(journal.entries.length);
  });

  it("gives the accounts of before the preferences none of their own", async () => {
    const ana = await pool.query("SELECT preferences FROM users WHERE email = 'ana@example.com'");
    expect(ana.rows[0]?.preferences).toEqual({});
  });

  it("keeps settings stored by the first release", async () => {
    const device = await pool.query(
      "SELECT pending_settings FROM devices WHERE device_key = 'iphone-upgrade'",
    );
    expect(device.rows[0]?.pending_settings).toBe("battery-saver");
  });
});
