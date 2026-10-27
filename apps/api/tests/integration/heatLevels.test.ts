import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillHeatLevels } from "../../src/heatmap/fillHeatLevels";
import { heatCellZooms } from "../../src/heatmap/heatCellLevels";
import { heatCellsUpsert } from "../../src/heatmap/heatCellsUpsert";
import { rebuildHeatCells } from "../../src/heatmap/rebuildHeatCells";
import { latToTileY, lonToTileX } from "../../src/heatmap/tileMath";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * Every start brings each device's stored heat levels in line with its points
 * (docs/architecture.md §8.2, §10): a level a release added (20), or one an
 * older release left behind after a rollback, is rebuilt from the points.
 */
let t: TestContext;
let owner: Agent;
const devices: { id: string; token: string }[] = [];
/** The five levels of the releases before level 20. */
const olderLevels = [6, 9, 12, 15, 18];

/** The fixture `days` days later: the same ride, new points. */
const later = (days: number) => {
  const batch = overlandFixture();
  for (const feature of batch.locations) {
    const { timestamp } = feature.properties;
    if (typeof timestamp === "string") {
      feature.properties["timestamp"] = new Date(Date.parse(timestamp) + days * 86_400_000)
        .toISOString()
        .replace(".000Z", "Z");
    }
  }
  return batch;
};

const device = (index: number) => {
  const found = devices[index];
  if (found === undefined) throw new Error(`no device ${index}`);
  return found;
};

/** As an install from before level 20 is left after the upgrade. */
const withoutLevel20 = () => t.ctx.db.execute(sql`DELETE FROM heat_cells WHERE z = 20`);

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

/** A device's total count per level, and its points that count. */
const levelTotals = async (deviceId: string) => {
  const rows = await t.ctx.db.execute<{ z: number; total: number }>(sql`
    SELECT z, sum(count)::int AS total FROM heat_cells WHERE device_id = ${deviceId}
    GROUP BY z ORDER BY z
  `);
  return rows.rows;
};
const countedPoints = async (deviceId: string) => {
  const rows = await t.ctx.db.execute<{ points: number }>(sql`
    SELECT count(*)::int AS points FROM locations
    WHERE device_id = ${deviceId} AND (horizontal_accuracy IS NULL OR horizontal_accuracy <= 200)
  `);
  return rows.rows[0]?.points ?? 0;
};
const everyLevelHolds = async (deviceId: string) => {
  const points = await countedPoints(deviceId);
  expect(await levelTotals(deviceId)).toEqual(heatCellZooms.map((z) => ({ z, total: points })));
};

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = agentFor(t.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  for (const name of ["iPhone", "iPad"]) {
    const created = await createDevice(owner, { name });
    devices.push({ id: created.device.id, token: created.credentials.accessToken });
    await postOverland(t.app, created.credentials.accessToken, overlandFixture()).expect(200);
  }
});

afterAll(async () => {
  await t.close();
});

describe("filling in heat levels", () => {
  it("does nothing while every device's levels hold its points", async () => {
    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ devices: 0, complete: true });
  });

  it("builds level 20 for the points from before it, counting a later upload once", async () => {
    await withoutLevel20();
    // An upload after the upgrade adds its points to level 20 already.
    await postOverland(t.app, device(0).token, later(1)).expect(200);

    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ devices: 2, complete: true });
    expect(await storedLevel20()).toEqual(await expectedLevel20());
    await everyLevelHolds(device(0).id);
    await everyLevelHolds(device(1).id);
    // The next start finds nothing to do.
    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ devices: 0, complete: true });
  });

  it("repairs what an older release left behind after a rollback and back", async () => {
    const [iPhone, iPad] = [device(0).id, device(1).id];
    // That release's uploads add to its five levels only…
    await t.ctx.db.execute(sql`
      INSERT INTO locations (device_id, recorded_at, lat, lon, horizontal_accuracy)
      SELECT ${iPhone}::uuid, timestamptz '2026-10-10 12:00:00+00' + n * interval '1 second',
        51.05 + n * 0.0001, 3.72, 10
      FROM generate_series(1, 400) AS n
    `);
    await t.ctx.db.execute(
      heatCellsUpsert(
        iPhone,
        sql`(SELECT recorded_at, lat, lon, horizontal_accuracy FROM locations
          WHERE device_id = ${iPhone} AND recorded_at > timestamptz '2026-10-10 12:00:00+00')`,
        olderLevels,
      ),
    );
    // …and its rebuilds (a deleted period, its `trail recompute`) drop every level, then add five.
    await t.ctx.db.execute(sql`DELETE FROM heat_cells WHERE device_id = ${iPad}`);
    await t.ctx.db.execute(
      heatCellsUpsert(
        iPad,
        sql`(SELECT recorded_at, lat, lon, horizontal_accuracy FROM locations WHERE device_id = ${iPad})`,
        olderLevels,
      ),
    );

    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ devices: 2, complete: true });
    expect(await storedLevel20()).toEqual(await expectedLevel20());
    await everyLevelHolds(iPhone);
    await everyLevelHolds(iPad);
  });

  it("stops after a device when asked, and the next start does the rest", async () => {
    await withoutLevel20();
    const abort = new AbortController();
    // Stopped as soon as the first device is done.
    const logger = pino(
      { level: "info" },
      {
        write(line: string) {
          if (line.includes("heat cells filled in")) abort.abort();
        },
      },
    );
    expect(await fillHeatLevels(t.ctx.db, logger, abort.signal)).toEqual({
      devices: 1,
      complete: false,
    });
    const filled = await t.ctx.db.execute<{ devices: number }>(
      sql`SELECT count(DISTINCT device_id)::int AS devices FROM heat_cells WHERE z = 20`,
    );
    expect(filled.rows[0]?.devices).toBe(1);

    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ devices: 1, complete: true });
    expect(await storedLevel20()).toEqual(await expectedLevel20());
  });

  it("stops while it waits for a device's lock, at once and keeping nothing", async () => {
    await withoutLevel20();
    // Another transaction holds the first device's row, as an upload in progress does.
    const holder = await t.ctx.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM devices WHERE id = $1 FOR UPDATE", [device(0).id]);
      const abort = new AbortController();
      const filling = fillHeatLevels(t.ctx.db, t.ctx.logger, abort.signal);
      // The fill is in its statement now, waiting for the lock.
      await sleep(500);
      const stopped = Date.now();
      abort.abort();
      expect(await filling).toEqual({ devices: 0, complete: false });
      expect(Date.now() - stopped).toBeLessThan(1_500);
      // Still held: the fill gave up rather than waited.
      const held = await t.ctx.db.execute<{ waiting: number }>(sql`
        SELECT count(*)::int AS waiting FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'transactionid' AND NOT l.granted AND a.query LIKE '%FOR UPDATE%'
      `);
      expect(held.rows[0]?.waiting).toBe(0);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    // Nothing was half-built: the next start does it all.
    expect(await fillHeatLevels(t.ctx.db, t.ctx.logger)).toEqual({ devices: 2, complete: true });
    expect(await storedLevel20()).toEqual(await expectedLevel20());
  });

  it("makes an upload of a device wait while its cells are rebuilt, and counts it once", async () => {
    await withoutLevel20();
    const { id, token } = device(0);
    let upload: Promise<number> | undefined;
    await t.ctx.db.transaction(async (tx) => {
      // The fill's own step: the device's row lock, held until this transaction commits.
      await rebuildHeatCells(tx, id, [20]);
      upload = postOverland(t.app, token, later(2)).then((response) => response.status);
      const first = await Promise.race([
        upload.then(() => "answered"),
        sleep(1_000).then(() => "waiting"),
      ]);
      expect(first).toBe("waiting");
    });
    expect(await upload).toBe(200);
    // Its points are in level 20 once: added by the upload after the rebuild committed.
    await everyLevelHolds(id);
  });

  it("leaves the levels that hold their points as they are", async () => {
    await withoutLevel20();
    const others = async () =>
      (
        await t.ctx.db.execute<{ z: number; cells: number; total: number }>(sql`
        SELECT z, count(*)::int AS cells, sum(count)::int AS total FROM heat_cells
        WHERE z <> 20 GROUP BY z ORDER BY z
      `)
      ).rows;
    const before = await others();
    await fillHeatLevels(t.ctx.db, t.ctx.logger);
    expect(await others()).toEqual(before);
  });
});
