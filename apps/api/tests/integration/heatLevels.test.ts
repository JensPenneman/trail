import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillHeatLevels } from "../../src/heatmap/fillHeatLevels";
import { heatCellZooms } from "../../src/heatmap/heatCellLevels";
import { latToTileY, lonToTileX } from "../../src/heatmap/tileMath";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * A stored heat level added by a release (level 20) is filled in once after
 * the upgrade, from every device's points (docs/architecture.md §8.2, §10).
 */
let t: TestContext;
let owner: Agent;
const tokens: string[] = [];

/** The fixture a day later: the same ride, new points. */
const nextDay = () => {
  const batch = overlandFixture();
  for (const feature of batch.locations) {
    const { timestamp } = feature.properties;
    if (typeof timestamp === "string") {
      feature.properties["timestamp"] = new Date(Date.parse(timestamp) + 86_400_000)
        .toISOString()
        .replace(".000Z", "Z");
    }
  }
  return batch;
};

/** An install from before level 20, as it is left after the upgrade: no level 20, nothing recorded. */
const asBeforeLevel20 = async () => {
  await t.ctx.db.execute(sql`DELETE FROM heat_cells WHERE z = 20`);
  await t.ctx.db.execute(sql`DELETE FROM processing_state WHERE key = 'heat_levels'`);
};

/** Level 20 worked out here from the points (`tileMath`, not the SQL that stores the cells). */
const expectedLevel20 = async () => {
  const points = await t.ctx.db.execute<{ device_id: string; lon: number; lat: number }>(sql`
    SELECT device_id, lon, lat FROM locations
    WHERE horizontal_accuracy IS NULL OR horizontal_accuracy <= 200
  `);
  const cells = new Map<string, number>();
  for (const point of points.rows) {
    const key = `${point.device_id} ${lonToTileX(point.lon, 20)},${latToTileY(point.lat, 20)}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  return cells;
};

const storedLevel20 = async () => {
  const rows = await t.ctx.db.execute<{ device_id: string; x: number; y: number; count: number }>(
    sql`SELECT device_id, x, y, count FROM heat_cells WHERE z = 20`,
  );
  return new Map(rows.rows.map((row) => [`${row.device_id} ${row.x},${row.y}`, row.count]));
};

const totalsByLevel = async () => {
  const rows = await t.ctx.db.execute<{ z: number; total: number }>(
    sql`SELECT z, sum(count)::int AS total FROM heat_cells GROUP BY z ORDER BY z`,
  );
  return rows.rows;
};

const recorded = async () => {
  const rows = await t.ctx.db.execute<{ value: unknown }>(
    sql`SELECT value FROM processing_state WHERE key = 'heat_levels'`,
  );
  return rows.rows[0]?.value;
};

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  for (const name of ["iPhone", "iPad"]) {
    const created = await createDevice(owner, { name });
    tokens.push(created.credentials.accessToken);
    await postOverland(t.app, created.credentials.accessToken, overlandFixture()).expect(200);
  }
});

afterAll(async () => {
  await t.close();
});

describe("filling in a stored heat level", () => {
  it("builds level 20 from every device's points once, and records the levels", async () => {
    await asBeforeLevel20();
    // An upload after the upgrade adds its points to level 20 already: they must count once.
    await postOverland(t.app, tokens[0] ?? "", nextDay()).expect(200);

    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ levels: [20], devices: 2 });
    expect(await storedLevel20()).toEqual(await expectedLevel20());
    // Every level holds every point once: 30 + 30 for the iPhone, 30 for the iPad.
    expect(await totalsByLevel()).toEqual(heatCellZooms.map((z) => ({ z, total: 90 })));
    expect(await recorded()).toEqual({ levels: [...heatCellZooms] });

    // Once: a later start finds the levels recorded and does nothing.
    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ levels: [], devices: 0 });
  });

  it("records nothing when stopped half-way, so that the next start begins again", async () => {
    await asBeforeLevel20();
    const abort = new AbortController();
    abort.abort();
    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger, abort.signal)).toEqual({
      levels: [20],
      devices: 0,
    });
    expect(await recorded()).toBeUndefined();

    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ levels: [20], devices: 2 });
    expect(await storedLevel20()).toEqual(await expectedLevel20());
  });

  it("leaves the other levels as they are", async () => {
    await asBeforeLevel20();
    const before = (await totalsByLevel()).filter((row) => row.z !== 20);
    await fillHeatLevels(t.ctx.db, t.ctx.logger);
    expect((await totalsByLevel()).filter((row) => row.z !== 20)).toEqual(before);
  });
});
