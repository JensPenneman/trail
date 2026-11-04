import { sql } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const logger = pino({ level: "silent" });

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: new FixtureWaySource() });
  const { agent } = await signUpWithCookie(t.app, "first@example.com");
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
});
