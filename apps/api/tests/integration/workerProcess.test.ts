import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueWindow } from "../../src/processing/processingQueue";
import { readHeartbeats } from "../../src/worker/workerHeartbeats";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { eventually } from "../support/eventually";
import { sparseTrain } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";
import { testDatabaseUrl, testEnvironment } from "../support/testEnvironment";

/*
 * The entries as the image runs them, here from the sources through tsx:
 * `trail worker` stops on SIGTERM only after the pass it is in has committed,
 * answers its liveness probe on PROCESSING_METRICS_PORT and, in the stall of
 * the health check's test, stands still; the server's entry starts what its
 * PROCESSING_ROLE says — no worker in role `api`, no HTTP server in role
 * `worker`.
 */
const apiRoot = fileURLToPath(new URL("../..", import.meta.url));
/** tsx compiles the sources first: a start may take a few seconds on a slow machine. */
const startTimeoutMs = 30_000;

interface Spawned {
  child: ChildProcess;
  /** The process's log lines (pino JSON on stdout). */
  lines: Record<string, unknown>[];
  exited: Promise<number | null>;
}

function spawnEntry(entry: string, args: string[], env: Record<string, string>): Spawned {
  const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: apiRoot,
    env: { ...process.env, ...testEnvironment({ LOG_LEVEL: "info", ...env }) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: Record<string, unknown>[] = [];
  if (child.stdout !== null) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        lines.push({ msg: line });
      }
    });
  }
  // Read, so a full pipe never blocks the child; shown only when a test fails on it.
  child.stderr?.on("data", () => {});
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
  return { child, lines, exited };
}

const logged = (spawned: Spawned, message: string) =>
  spawned.lines.some((line) => line["msg"] === message);

const messageIndex = (spawned: Spawned, message: string) =>
  spawned.lines.findIndex((line) => line["msg"] === message);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

let t: TestContext;
let device = { id: "", token: "" };

const count = async (statement: ReturnType<typeof sql>) =>
  (await t.ctx.db.execute<{ count: number }>(statement)).rows[0]?.count ?? -1;

beforeAll(async () => {
  await resetDatabase();
  // The data comes in through an API that only queues: the spawned processes work it out.
  t = await createTestContext({ env: { PROCESSING_ROLE: "api" } });
  const { agent } = await signUpWithCookie(t.app, "first@example.com");
  const created = await createDevice(agent, { name: "Commuter" });
  device = { id: created.device.id, token: created.credentials.accessToken };
});

afterAll(async () => {
  await t.close();
});

describe("trail worker", () => {
  it("lets the pass in progress commit on SIGTERM, then exits 0", async () => {
    await uploadJourney(t.app, device.token, sparseTrain());
    await t.ctx.background.drain(5000);
    const queued = sql`SELECT count(*)::int AS count FROM processing_queue WHERE device_id = ${device.id}`;
    expect(await count(queued)).toBe(1);

    // The pass waits at its first write while this lock is held: mid-pass, its transaction open.
    const holder = new pg.Client({ connectionString: testDatabaseUrl });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE processed_points IN EXCLUSIVE MODE");
    const worker = spawnEntry("src/cli.ts", ["worker"], { PROCESSING_ROLE: "worker" });
    try {
      await eventually(
        "the worker's pass waiting at its write",
        async () =>
          (await count(sql`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE application_name = 'trail-worker' AND wait_event_type = 'Lock'
          `)) > 0,
        startTimeoutMs,
      );
      worker.child.kill("SIGTERM");
      await eventually("the worker shutting down", () => logged(worker, "shutting down"));
      await holder.query("COMMIT");
      expect(await worker.exited).toBe(0);
    } finally {
      worker.child.kill("SIGKILL");
      await holder.end();
    }

    // The pass committed whole, after the signal and before the exit.
    const order = ["shutting down", "processing window done", "stopped"].map((message) =>
      messageIndex(worker, message),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(await count(queued)).toBe(0);
    expect(
      await count(sql`SELECT count(*)::int AS count FROM segments WHERE device_id = ${device.id}`),
    ).toBe(3);
    expect(
      await count(sql`
        SELECT count(*)::int AS count FROM processed_points WHERE device_id = ${device.id}
      `),
    ).toBe(
      await count(sql`SELECT count(*)::int AS count FROM locations WHERE device_id = ${device.id}`),
    );
    // Its heartbeat stays until the hourly prune, with the pass counted.
    const [beat] = await readHeartbeats(t.ctx.db);
    expect(beat).toMatchObject({ passes: 1 });
  });

  it("stands still after its first heartbeat in the stall of the health check's test", async () => {
    const port = await freePort();
    const worker = spawnEntry("src/cli.ts", ["worker"], {
      PROCESSING_ROLE: "worker",
      PROCESSING_METRICS_PORT: String(port),
      PROCESSING_TEST_STALL: "true",
      HOST: "127.0.0.1",
    });
    try {
      await eventually(
        "the worker started",
        () => logged(worker, "Trail worker started"),
        startTimeoutMs,
      );
      const started = worker.lines.find((line) => line["msg"] === "Trail worker started");
      expect(
        worker.lines.some((line) => String(line["msg"]).startsWith("PROCESSING_TEST_STALL is set")),
      ).toBe(true);
      // Its probe is live until the first beat is 90 s old.
      expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(200);
      const beatOf = async () =>
        (await readHeartbeats(t.ctx.db)).find((row) => row.id === started?.["worker"]);
      const first = await beatOf();
      expect(first).toBeDefined();
      // A ready window: a worker that ran would take it within its 2 s poll.
      await enqueueWindow(t.ctx.db, {
        deviceId: device.id,
        from: new Date("2026-10-01T08:00:00Z"),
        to: new Date("2026-10-01T09:00:00Z"),
        reason: "reprocess",
      });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const queued = sql`SELECT count(*)::int AS count FROM processing_queue WHERE device_id = ${device.id}`;
      expect(await count(queued)).toBe(1);
      expect(logged(worker, "processing window done")).toBe(false);
      worker.child.kill("SIGTERM");
      expect(await worker.exited).toBe(0);
      // No heartbeat after the first, not even at the stop.
      expect((await beatOf())?.lastSeenAt).toEqual(first?.lastSeenAt);
    } finally {
      worker.child.kill("SIGKILL");
      await t.ctx.db.execute(sql`DELETE FROM processing_queue WHERE device_id = ${device.id}`);
    }
  });
});

describe("the server's entry", () => {
  it("in role worker runs the worker and its liveness probe, and no HTTP server", async () => {
    const port = await freePort();
    let probePort = await freePort();
    while (probePort === port) probePort = await freePort();
    const before = (await readHeartbeats(t.ctx.db)).length;
    const worker = spawnEntry("src/main.ts", [], {
      PROCESSING_ROLE: "worker",
      HOST: "127.0.0.1",
      PORT: String(port),
      PROCESSING_METRICS_PORT: String(probePort),
    });
    try {
      await eventually(
        "the worker started",
        () => logged(worker, "Trail worker started"),
        startTimeoutMs,
      );
      expect((await readHeartbeats(t.ctx.db)).length).toBe(before + 1);
      await expect(fetch(`http://127.0.0.1:${port}/api/health/live`)).rejects.toThrow();
      const live = await fetch(`http://127.0.0.1:${probePort}/health/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toMatchObject({ status: "ok" });
      expect((await fetch(`http://127.0.0.1:${probePort}/api/health/live`)).status).toBe(404);
      worker.child.kill("SIGTERM");
      expect(await worker.exited).toBe(0);
    } finally {
      worker.child.kill("SIGKILL");
    }
  });

  it("in role api serves and starts no worker; in role all it does both", async () => {
    const before = (await readHeartbeats(t.ctx.db)).length;
    for (const role of ["api", "all"] as const) {
      const port = await freePort();
      const server = spawnEntry("src/main.ts", [], {
        PROCESSING_ROLE: role,
        HOST: "127.0.0.1",
        PORT: String(port),
      });
      try {
        await eventually(
          "the API listening",
          () => logged(server, "Trail API listening"),
          startTimeoutMs,
        );
        expect((await fetch(`http://127.0.0.1:${port}/api/health/live`)).status).toBe(200);
        if (role === "all") {
          await eventually(
            "the in-process worker's heartbeat",
            async () => (await readHeartbeats(t.ctx.db)).length === before + 1,
          );
        } else {
          // Its first heartbeat would come right after the start, as in role all.
          await new Promise((resolve) => setTimeout(resolve, 1000));
          expect((await readHeartbeats(t.ctx.db)).length).toBe(before);
        }
        server.child.kill("SIGTERM");
        expect(await server.exited).toBe(0);
      } finally {
        server.child.kill("SIGKILL");
      }
    }
  });
});
