import { hostname } from "node:os";
import { apiPaths } from "@trail/contracts/apiPaths";
import { healthSchema } from "@trail/contracts/health";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { queuedCountLimit } from "../../src/health/readProcessingHealth";
import { readHeartbeats } from "../../src/worker/workerHeartbeats";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { sparseTrain } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";
import { createWorkerContext } from "../support/workerContext";

/*
 * What `/api/health` and `/api/health/processing` say of the worker
 * (docs/architecture.md §3, §8): up or down from the newest heartbeat against
 * the database's clock, how long ago that was and how many windows wait —
 * never which worker, host or process — with `/api/health` at 200 whatever the
 * worker does and the processing route at 503 while it is down.
 */
let api: TestContext;
let device = { id: "", token: "" };

const health = async (path: string, status: number) => {
  const response = await request(api.app).get(path).expect(status);
  return healthSchema.parse(response.body);
};

/**
 * A worker that beats at its start and at its stop and processes nothing
 * (processing off in its own process), so the queue stays as the test left it.
 */
async function workerBeats(): Promise<void> {
  const worker = await createWorkerContext({ env: { PROCESSING_ENABLED: "false" } });
  try {
    await worker.loop.start();
  } finally {
    await worker.close();
  }
}

/** Moves every heartbeat into the past by the database's clock. */
async function lastSeenAgo(seconds: number): Promise<void> {
  await api.ctx.db.execute(sql`
    UPDATE processing_workers SET last_seen_at = now() - make_interval(secs => ${seconds})
  `);
}

beforeAll(async () => {
  await resetDatabase();
  api = await createTestContext({ env: { PROCESSING_ROLE: "api" } });
  const { agent } = await signUpWithCookie(api.app, "first@example.com");
  const created = await createDevice(agent, { name: "Commuter" });
  device = { id: created.device.id, token: created.credentials.accessToken };
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.ctx.db.execute(sql`DELETE FROM processing_workers`);
  await api.ctx.db.execute(sql`DELETE FROM processing_queue`);
});

describe("the processing summary of /api/health", () => {
  it("says down before any worker beat, with /api/health still 200", async () => {
    expect(await health(apiPaths.health, 200)).toMatchObject({
      status: "ok",
      db: "ok",
      processing: { worker: "down", lastSeenS: null, queued: 0 },
    });
    expect(await health(apiPaths.healthProcessing, 503)).toMatchObject({
      status: "unavailable",
      db: "ok",
      processing: { worker: "down", lastSeenS: null },
    });
  });

  it("says up while a worker beats, and counts the windows that wait", async () => {
    // The API in role `api` queues the upload's window and works nothing out.
    await uploadJourney(api.app, device.token, sparseTrain());
    await api.ctx.background.drain(5000);
    await workerBeats();

    const up = await health(apiPaths.health, 200);
    expect(up.processing).toEqual({ worker: "up", lastSeenS: expect.any(Number), queued: 1 });
    expect(up.processing?.lastSeenS).toBeLessThanOrEqual(2);
    expect(await health(apiPaths.healthProcessing, 200)).toMatchObject({
      status: "ok",
      processing: { worker: "up", queued: 1 },
    });
  });

  it("says down 90 s after the newest beat, by the database's clock alone", async () => {
    await workerBeats();
    // The worker's own clock says nothing: a start a day ahead changes no answer.
    await api.ctx.db.execute(
      sql`UPDATE processing_workers SET started_at = now() + interval '1 day'`,
    );
    await lastSeenAgo(85);
    const recent = await health(apiPaths.health, 200);
    expect(recent.processing?.worker).toBe("up");
    expect(recent.processing?.lastSeenS).toBeGreaterThanOrEqual(85);
    expect(recent.processing?.lastSeenS).toBeLessThan(90);
    await health(apiPaths.healthProcessing, 200);

    await lastSeenAgo(91);
    const gone = await health(apiPaths.health, 200);
    expect(gone).toMatchObject({ status: "ok", processing: { worker: "down" } });
    expect(gone.processing?.lastSeenS).toBeGreaterThanOrEqual(91);
    expect(await health(apiPaths.healthProcessing, 503)).toMatchObject({
      status: "unavailable",
      processing: { worker: "down" },
    });
  });

  it("takes the newest of several workers' beats", async () => {
    await workerBeats();
    await lastSeenAgo(600);
    await workerBeats();
    const { processing } = await health(apiPaths.health, 200);
    expect(processing?.worker).toBe("up");
    expect(processing?.lastSeenS).toBeLessThanOrEqual(2);
  });

  it("never names a worker, its host or its process", async () => {
    await workerBeats();
    const [beat] = await readHeartbeats(api.ctx.db);
    expect(beat?.id).toContain(hostname());
    for (const path of [apiPaths.health, apiPaths.healthProcessing]) {
      const response = await request(api.app).get(path).expect(200);
      expect(Object.keys(response.body.processing).sort()).toEqual([
        "lastSeenS",
        "queued",
        "worker",
      ]);
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(beat?.id ?? "no heartbeat");
      expect(text).not.toContain(hostname());
      expect(text).not.toContain(`:${process.pid}:`);
    }
  });

  it("counts at most 10 000 queued windows", async () => {
    await api.ctx.db.execute(sql`
      INSERT INTO processing_queue (device_id, from_at, to_at, reason, priority)
      SELECT ${device.id}::uuid,
        timestamptz '2020-01-01T00:00:00Z' + n * interval '1 hour',
        timestamptz '2020-01-01T00:00:00Z' + (n + 1) * interval '1 hour',
        'backfill', 1
      FROM generate_series(1, ${queuedCountLimit + 1}::int) AS n
    `);
    expect((await health(apiPaths.health, 200)).processing?.queued).toBe(queuedCountLimit);
  });
});

describe("without processing or a database", () => {
  it("says none with processing switched off, and both routes answer 200", async () => {
    const off = await createTestContext({
      env: { PROCESSING_ROLE: "api", PROCESSING_ENABLED: "false" },
    });
    try {
      const body = healthSchema.parse(
        (await request(off.app).get(apiPaths.health).expect(200)).body,
      );
      expect(body.processing).toEqual({ worker: "none", lastSeenS: null, queued: 0 });
      await request(off.app).get(apiPaths.healthProcessing).expect(200);
    } finally {
      await off.close();
    }
  });

  it("answers 503 on both routes, without a summary, when the database is down", async () => {
    const offline = await createTestContext({
      env: { DATABASE_URL: "postgres://trail:trail@127.0.0.1:1/trail_test" },
    });
    try {
      for (const path of [apiPaths.health, apiPaths.healthProcessing]) {
        const body = healthSchema.parse((await request(offline.app).get(path).expect(503)).body);
        expect(body).toMatchObject({ status: "unavailable", db: "down" });
        expect(body.processing).toBeUndefined();
      }
      await request(offline.app).get(apiPaths.healthLive).expect(200);
    } finally {
      await offline.close();
    }
  });
});
