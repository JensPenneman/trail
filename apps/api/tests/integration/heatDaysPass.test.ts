import { sql } from "drizzle-orm";
import pg from "pg";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeSegmentsNotice, processingChannel } from "../../src/events/processingNotify";
import { HeatDaysScheduler } from "../../src/heatmap/heatDaysScheduler";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { motorwayDrive } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * A pass writes the per-day heat cells apart from itself (docs/architecture.md §8.2): once it has
 * committed, a debounced run rebuilds the days it touched, and an error there never undoes a pass.
 */
let t: TestContext;
let device = "";
let token = "";
let agent: Awaited<ReturnType<typeof signUpWithCookie>>["agent"];
const logger = pino({ level: "silent" });

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: new FixtureWaySource() });
  ({ agent } = await signUpWithCookie(t.app, "first@example.com"));
  const made = await createDevice(agent, { name: "Drive" });
  device = made.device.id;
  token = made.credentials.accessToken;
});

afterAll(async () => {
  await t.close();
});

const rows = async () =>
  (
    await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM heat_days WHERE device_id = ${device}::uuid`,
    )
  ).rows[0]?.n ?? 0;
const marks = async () =>
  (
    await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM heat_day_marks WHERE device_id = ${device}::uuid`,
    )
  ).rows[0]?.n ?? 0;
const moves = async () =>
  (
    await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM segments WHERE device_id = ${device}::uuid`,
    )
  ).rows[0]?.n ?? 0;

describe("the per-day cells of a pass", () => {
  it("are written after the pass, by the debounced run", async () => {
    await uploadJourney(t.app, token, motorwayDrive());
    await t.ctx.background.drain(5000);
    await t.ctx.processing.flush();
    expect(await moves()).toBeGreaterThan(0);
    expect(await rows()).toBeGreaterThan(0);
    const modes = await t.ctx.db.execute<{ mode: string }>(
      sql`SELECT DISTINCT mode FROM heat_days WHERE device_id = ${device}::uuid ORDER BY mode`,
    );
    expect(modes.rows.map((row) => row.mode)).toContain("car");
  });

  it("never undo a pass when they cannot be written, and are made when they can", async () => {
    await t.ctx.db.execute(sql`DELETE FROM heat_days WHERE device_id = ${device}::uuid`);
    await t.ctx.db.execute(sql`DELETE FROM segments WHERE device_id = ${device}::uuid`);
    await t.ctx.db.execute(
      sql`ALTER TABLE heat_days ADD CONSTRAINT heat_days_boom CHECK (points < 0) NOT VALID`,
    );
    try {
      await uploadJourney(t.app, token, motorwayDrive(1_793_100_000));
      await t.ctx.background.drain(5000);
      await t.ctx.processing.flush();
      // The pass committed its segments; the days stay marked, the cells are not there.
      expect(await moves()).toBeGreaterThan(0);
      expect(await rows()).toBe(0);
      expect(await marks()).toBeGreaterThan(0);
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE heat_days DROP CONSTRAINT heat_days_boom`);
    }
    const queued = await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM processing_queue WHERE device_id = ${device}::uuid`,
    );
    expect(queued.rows[0]?.n).toBe(0);
    // Tried again, they are made and the marks go.
    await new HeatDaysScheduler(t.ctx.db, logger).flush();
    expect(await rows()).toBeGreaterThan(0);
    expect(await marks()).toBe(0);
  });

  it("survive a crash between the mark and the rebuild: a new process drains them at start", async () => {
    await t.ctx.db.execute(sql`DELETE FROM heat_days WHERE device_id = ${device}::uuid`);
    const day = (
      await t.ctx.db.execute<{ day: string }>(
        sql`SELECT (started_at AT TIME ZONE 'UTC')::date::text AS day FROM segments WHERE device_id = ${device}::uuid LIMIT 1`,
      )
    ).rows[0]?.day;
    await t.ctx.db.execute(
      sql`INSERT INTO heat_day_marks (device_id, day) VALUES (${device}::uuid, ${day}::date)`,
    );
    expect(await rows()).toBe(0);
    // The process that marked it is gone; this one starts.
    await new HeatDaysScheduler(t.ctx.db, logger).recover();
    expect(await rows()).toBeGreaterThan(0);
    expect(await marks()).toBe(0);
  });

  it("retries a failed run with a wait of its own", async () => {
    await t.ctx.db.execute(sql`DELETE FROM heat_days WHERE device_id = ${device}::uuid`);
    const day = (
      await t.ctx.db.execute<{ day: string }>(
        sql`SELECT (started_at AT TIME ZONE 'UTC')::date::text AS day FROM segments WHERE device_id = ${device}::uuid LIMIT 1`,
      )
    ).rows[0]?.day;
    await t.ctx.db.execute(
      sql`INSERT INTO heat_day_marks (device_id, day) VALUES (${device}::uuid, ${day}::date)`,
    );
    await t.ctx.db.execute(
      sql`ALTER TABLE heat_days ADD CONSTRAINT heat_days_boom CHECK (points < 0) NOT VALID`,
    );
    const scheduler = new HeatDaysScheduler(t.ctx.db, logger, { retryMs: 50 });
    await scheduler.flush();
    expect(await rows()).toBe(0);
    expect(await marks()).toBe(1);
    await t.ctx.db.execute(sql`ALTER TABLE heat_days DROP CONSTRAINT heat_days_boom`);
    // The run armed itself again: without anyone asking, the days are made.
    await vi.waitFor(async () => expect(await marks()).toBe(0), { timeout: 5000 });
    expect(await rows()).toBeGreaterThan(0);
    scheduler.stop();
  });

  it("marks recent days whose points are newer than their cells when a process starts", async () => {
    await t.ctx.db.execute(sql`DELETE FROM heat_day_marks`);
    // Cells made before the points were last written: a pass that never got to rebuild them.
    await t.ctx.db.execute(sql`
      UPDATE heat_days SET computed_at = now() - interval '1 day' WHERE device_id = ${device}::uuid`);
    await t.ctx.db.execute(sql`
      UPDATE processed_points SET processed_at = now() WHERE device_id = ${device}::uuid`);
    await t.ctx.db.execute(sql`
      UPDATE segments SET started_at = started_at WHERE device_id = ${device}::uuid`);
    const before = (
      await t.ctx.db.execute<{ at: string }>(
        sql`SELECT max(computed_at)::text AS at FROM heat_days WHERE device_id = ${device}::uuid`,
      )
    ).rows[0]?.at;
    await new HeatDaysScheduler(t.ctx.db, logger).recover();
    const after = (
      await t.ctx.db.execute<{ at: string }>(
        sql`SELECT max(computed_at)::text AS at FROM heat_days WHERE device_id = ${device}::uuid`,
      )
    ).rows[0]?.at;
    expect(after).not.toBe(before);
    expect(await marks()).toBe(0);
  });

  it("keeps a device that fails to itself: another's marks are served in its wait", async () => {
    const other = await createDevice(agent, { name: "Other drive" });
    await uploadJourney(t.app, other.credentials.accessToken, motorwayDrive(1_793_300_000));
    await t.ctx.background.drain(5000);
    await t.ctx.processing.flush();
    await new HeatDaysScheduler(t.ctx.db, logger).flush();
    const otherId = other.device.id;
    const count = async (table: string, id: string) =>
      (
        await t.ctx.db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE device_id = ${id}::uuid`,
        )
      ).rows[0]?.n ?? 0;
    const markAll = async (id: string) =>
      t.ctx.db.execute(sql`
        INSERT INTO heat_day_marks (device_id, day)
        SELECT DISTINCT ${id}::uuid, day FROM heat_days WHERE device_id = ${id}::uuid
        ON CONFLICT DO NOTHING`);
    await markAll(device);
    await markAll(otherId);
    // The first device cannot be written; its wait is long, the other one's marks are not held back.
    await t.ctx.db.execute(
      sql.raw(
        `ALTER TABLE heat_days ADD CONSTRAINT heat_days_boom CHECK (device_id <> '${device}'::uuid) NOT VALID`,
      ),
    );
    const scheduler = new HeatDaysScheduler(t.ctx.db, logger, { delayMs: 20, retryMs: 600_000 });
    try {
      await scheduler.flush();
      expect(await count("heat_day_marks", device)).toBeGreaterThan(0);
      expect(await count("heat_day_marks", otherId)).toBe(0);
      // A pass marks the other device again while the first one's retry is armed far ahead.
      await t.ctx.db.execute(sql`
        INSERT INTO heat_day_marks (device_id, day)
        SELECT DISTINCT ${otherId}::uuid, day FROM heat_days WHERE device_id = ${otherId}::uuid`);
      scheduler.wake();
      await vi.waitFor(async () => expect(await count("heat_day_marks", otherId)).toBe(0), {
        timeout: 5000,
      });
      // The device in its wait is not hammered: still marked, still waiting.
      expect(await count("heat_day_marks", device)).toBeGreaterThan(0);
    } finally {
      scheduler.stop();
      await t.ctx.db.execute(sql`ALTER TABLE heat_days DROP CONSTRAINT heat_days_boom`);
    }
    await new HeatDaysScheduler(t.ctx.db, logger).flush();
    expect(await count("heat_day_marks", device)).toBe(0);
  });

  it("tells the owner's streams when a device's rebuild commits, and not when it fails", async () => {
    const listener = new pg.Client({ connectionString: t.ctx.config.databaseUrl });
    await listener.connect();
    const heard: string[] = [];
    listener.on("notification", (message) => {
      const notice = message.payload === undefined ? null : decodeSegmentsNotice(message.payload);
      if (notice !== null && notice.deviceId === device) heard.push(notice.kind ?? "segments");
    });
    await listener.query(`LISTEN ${processingChannel}`);
    try {
      const day = (
        await t.ctx.db.execute<{ day: string }>(
          sql`SELECT (started_at AT TIME ZONE 'UTC')::date::text AS day FROM segments WHERE device_id = ${device}::uuid LIMIT 1`,
        )
      ).rows[0]?.day;
      await t.ctx.db.execute(
        sql`INSERT INTO heat_day_marks (device_id, day) VALUES (${device}::uuid, ${day}::date) ON CONFLICT DO NOTHING`,
      );
      await t.ctx.db.execute(
        sql.raw(
          `ALTER TABLE heat_days ADD CONSTRAINT heat_days_boom2 CHECK (device_id <> '${device}'::uuid) NOT VALID`,
        ),
      );
      try {
        await new HeatDaysScheduler(t.ctx.db, logger).flush();
      } finally {
        await t.ctx.db.execute(sql`ALTER TABLE heat_days DROP CONSTRAINT heat_days_boom2`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(heard).toEqual([]);
      await new HeatDaysScheduler(t.ctx.db, logger).flush();
      await vi.waitFor(() => expect(heard.length).toBeGreaterThan(0), { timeout: 3000 });
      // A `heat` notice: the pass already told the rest with its `segments` event.
      expect(new Set(heard)).toEqual(new Set(["heat"]));
    } finally {
      await listener.end();
    }
  });
});
