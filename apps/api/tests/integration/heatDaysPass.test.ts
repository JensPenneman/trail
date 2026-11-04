import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("never undo a pass when they cannot be written", async () => {
    await t.ctx.db.execute(sql`DELETE FROM heat_days WHERE device_id = ${device}::uuid`);
    await t.ctx.db.execute(sql`DELETE FROM segments WHERE device_id = ${device}::uuid`);
    await t.ctx.db.execute(
      sql`ALTER TABLE heat_days ADD CONSTRAINT heat_days_boom CHECK (points < 0) NOT VALID`,
    );
    try {
      await uploadJourney(t.app, token, motorwayDrive(1_793_100_000));
      await t.ctx.background.drain(5000);
      await t.ctx.processing.flush();
      // The pass committed its segments; the cells are the days' to make again.
      expect(await moves()).toBeGreaterThan(0);
      expect(await rows()).toBe(0);
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE heat_days DROP CONSTRAINT heat_days_boom`);
    }
    const queued = await t.ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM processing_queue WHERE device_id = ${device}::uuid`,
    );
    expect(queued.rows[0]?.n).toBe(0);
  });
});
