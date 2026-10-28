import type { ServerEvent } from "@trail/contracts/events";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventBus } from "../../src/events/eventBus";
import { ProcessingListener } from "../../src/events/processingListener";
import { pruneExpiredData } from "../../src/jobs/pruneExpiredData";
import { createLogger } from "../../src/logging/createLogger";
import { readHeartbeats } from "../../src/worker/workerHeartbeats";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { eventually } from "../support/eventually";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, motorwayDrive, sparseTrain, walkInTown } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { SseClient } from "../support/sseClient";
import { createTestContext, type TestContext } from "../support/testContext";
import { testDatabaseUrl } from "../support/testEnvironment";
import { createWorkerContext, type WorkerContext } from "../support/workerContext";

/*
 * The two processes of docs/architecture.md §3 on one database: an API in
 * role `api`, which serves and queues but works nothing out, and a worker,
 * which does; a pass of the worker reaches the API's streams through the
 * processing channel, also after the listener lost its connection.
 */
let api: TestContext;
let worker: WorkerContext;
let owner: Agent;
let cookie = "";
let ownerId = "";

async function newDevice(name: string) {
  const device = await createDevice(owner, { name });
  return { id: device.device.id, token: device.credentials.accessToken };
}

/** Uploads a journey to the API and waits for the queueing that runs after the response. */
async function upload(token: string, points: Parameters<typeof uploadJourney>[2]) {
  await uploadJourney(api.app, token, points);
  await api.ctx.background.drain(5000);
}

const queued = async (deviceId: string) =>
  (
    await api.ctx.db.execute<{ reason: string }>(sql`
      SELECT reason FROM processing_queue WHERE device_id = ${deviceId} ORDER BY from_at
    `)
  ).rows.map((row) => row.reason);

const segmentCount = async (deviceId: string) =>
  (
    await api.ctx.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM segments WHERE device_id = ${deviceId}
    `)
  ).rows[0]?.count ?? 0;

const segmentsOf = (events: readonly ServerEvent[], deviceId: string) =>
  events.filter((event) => event.type === "segments" && event.deviceId === deviceId);

beforeAll(async () => {
  await resetDatabase();
  api = await createTestContext({ env: { PROCESSING_ROLE: "api" } });
  worker = await createWorkerContext({ waySource: new FixtureWaySource() });
  ({ agent: owner, cookie } = await signUpWithCookie(api.app, "first@example.com"));
  const user = await api.ctx.db.execute<{ id: string }>(sql`
    SELECT id FROM users WHERE email = 'first@example.com'
  `);
  ownerId = user.rows[0]?.id ?? "";
});

afterAll(async () => {
  await worker.close();
  await api.close();
});

describe("an API in role api and a worker on one database", () => {
  let commuter = { id: "", token: "" };

  beforeAll(async () => {
    commuter = await newDevice("Commuter");
  });

  it("the API queues an upload's window and starts no worker", async () => {
    expect(api.ctx.processing.runsWorker).toBe(false);
    api.ctx.processing.start();
    await upload(commuter.token, sparseTrain());
    await api.ctx.processing.flush();
    expect(await queued(commuter.id)).toEqual(["ingest"]);
    expect(await segmentCount(commuter.id)).toBe(0);
    // Nothing beats in the API's process.
    expect(await readHeartbeats(api.ctx.db)).toEqual([]);
  });

  it("the worker's pass reaches the API's streams through the processing channel", async () => {
    const events = await SseClient.connect(api.app, cookie);
    try {
      await events.waitFor("hello");
      await worker.loop.flush();
      expect(await queued(commuter.id)).toEqual([]);
      expect(await segmentCount(commuter.id)).toBe(3);
      const event = await events.waitFor("segments");
      expect(event.deviceId).toBe(commuter.id);
      expect(Date.parse(event.from)).toBeLessThanOrEqual(morning * 1000);
      expect(Date.parse(event.to)).toBeGreaterThan(morning * 1000);
    } finally {
      events.close();
    }
  });
});

describe("the API's listener", () => {
  it("comes back after its connection is dropped and announces what it missed", async () => {
    const bus = new EventBus();
    const received: ServerEvent[] = [];
    bus.subscribe(ownerId, {
      sessionId: "listener-test",
      send: (event) => received.push(event),
      close: () => {},
    });
    // The pause before reconnecting is held until the pass below has committed.
    const pauses: number[] = [];
    let paused = () => {};
    const reconnectPending = new Promise<void>((resolve) => {
      paused = resolve;
    });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listener = new ProcessingListener({
      connectionString: testDatabaseUrl,
      bus,
      logger: createLogger({ level: "silent" }),
      wait: async (ms) => {
        pauses.push(ms);
        paused();
        await released;
      },
    });
    await listener.start();
    try {
      expect(listener.listening).toBe(true);
      const first = listener.backendPid;
      expect(first).not.toBeNull();
      // The server ends the connection, as a restart of Postgres or a broken network does.
      await api.ctx.db.execute(sql`SELECT pg_terminate_backend(${first})`);
      await reconnectPending;
      expect(listener.listening).toBe(false);

      // A pass commits meanwhile: its message finds nobody on this listener's connection.
      const driver = await newDevice("Driver");
      await upload(driver.token, motorwayDrive(morning + 3600));
      await worker.loop.flush();
      expect(await segmentCount(driver.id)).toBeGreaterThan(0);
      expect(segmentsOf(received, driver.id)).toEqual([]);

      release();
      await eventually(
        "the missed pass announced",
        () => segmentsOf(received, driver.id).length > 0,
      );
      expect(listener.listening).toBe(true);
      expect(listener.backendPid).not.toBe(first);
      expect(pauses).toEqual([1000]);
      const [missed] = segmentsOf(received, driver.id);
      expect(missed).toMatchObject({ type: "segments", deviceId: driver.id });

      // Later passes arrive as they commit.
      const seen = received.length;
      await upload(driver.token, motorwayDrive(morning + 5 * 3600));
      await worker.loop.flush();
      await eventually(
        "the next pass announced",
        () => segmentsOf(received.slice(seen), driver.id).length > 0,
      );
    } finally {
      await listener.stop();
    }
    expect(listener.listening).toBe(false);
  });
});

describe("heartbeats", () => {
  it("are written by a running worker, read by the API and pruned an hour after the last", async () => {
    const beating = await createWorkerContext();
    const { id } = beating.loop;
    try {
      await beating.loop.start();
      const [seen] = (await readHeartbeats(api.ctx.db)).filter((row) => row.id === id);
      expect(seen).toMatchObject({
        id,
        version: beating.config.build.version,
        jobId: null,
        passes: 0,
        points: 0,
      });
      expect(Math.abs(Date.now() - (seen?.lastSeenAt.getTime() ?? 0))).toBeLessThan(10_000);

      // Nothing in this process wakes the worker: it finds the upload's window in the queue.
      const walker = await newDevice("Walker");
      await upload(walker.token, walkInTown(morning + 8 * 3600));
      await eventually("the walk processed", async () => (await queued(walker.id)).length === 0);
      expect(await segmentCount(walker.id)).toBeGreaterThan(0);
    } finally {
      await beating.close();
    }
    // The last beat, written by the stop, counts the passes (one per batch of the upload, or one).
    const [last] = (await readHeartbeats(api.ctx.db)).filter((row) => row.id === id);
    expect(last?.passes).toBeGreaterThanOrEqual(1);
    expect(last?.points).toBeGreaterThan(0);

    await api.ctx.db.execute(sql`
      UPDATE processing_workers SET last_seen_at = now() - interval '61 minutes' WHERE id = ${id}
    `);
    const pruned = await pruneExpiredData(api.ctx.db, api.ctx.config);
    expect(pruned.processingWorkers).toBe(1);
    expect((await readHeartbeats(api.ctx.db)).map((row) => row.id)).not.toContain(id);
  });
});
