import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLineJob } from "../../src/jobs/loadLineJob";
import { agentFor, signUp } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * The `load` line (docs/perf/README.md) from the real app: a minute's uploads
 * and points, the pool, streams and the processing queue — numbers only.
 */
let t: TestContext;
const lines: string[] = [];
const email = "first@example.com";
const deviceName = "Jens's iPhone";
let token = "";

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ logDestination: { write: (line: string) => lines.push(line) } });
  const agent = agentFor(t.app);
  await signUp(agent, new SoftwareAuthenticator(), email);
  token = (await createDevice(agent, { name: deviceName })).credentials.accessToken;
});

afterAll(async () => {
  await t.close();
});

const loadLines = () =>
  lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["msg"] === "load");

describe("the load line", () => {
  it("logs the minute's uploads, points and processing queue, and nothing of the device", async () => {
    const job = loadLineJob(t.ctx, 200);
    try {
      await postOverland(t.app, token, overlandFixture()).expect(200);
      // The minute of the upload, and the next one, which starts again from zero.
      await vi.waitFor(
        () => {
          const all = loadLines();
          const index = all.findIndex((line) => line["uploads"] === 1);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(all.slice(index + 1).some((line) => line["uploads"] === 0)).toBe(true);
        },
        { timeout: 10_000, interval: 50 },
      );
      // The queue's age is how long the oldest ready new data has waited since it was queued,
      // not since it became ready: a window queued ten minutes ago, ready for one.
      await t.ctx.db.execute(sql`
        UPDATE processing_queue
        SET enqueued_at = now() - interval '10 minutes', next_at = now() - interval '1 minute'
      `);
      await vi.waitFor(
        () => {
          const age = Number(loadLines().at(-1)?.["queueAgeS"]);
          expect(age).toBeGreaterThanOrEqual(600);
          expect(age).toBeLessThan(660);
        },
        { timeout: 10_000, interval: 50 },
      );
    } finally {
      await job.stop();
    }
    const line = loadLines().find((entry) => entry["uploads"] === 1);
    expect(line).toMatchObject({
      level: 30,
      intervalS: 0.2,
      points: 30,
      duplicates: 0,
      streams: 0,
      poolTotal: expect.any(Number),
      poolWaiting: 0,
      queueRows: 1,
      queueReady: 1,
      queueAgeS: expect.any(Number),
      rssMb: expect.any(Number),
      loopP99Ms: expect.any(Number),
    });

    const raw = lines.filter((entry) => entry.includes('"msg":"load"')).join("\n");
    for (const secret of [token, email, deviceName, "iphone-jens"])
      expect(raw).not.toContain(secret);
    // The fixture rides through Ghent (51.03–51.05° N, 3.69–3.73° E).
    expect(raw).not.toMatch(/51\.0[0-9]{2}|3\.[67][0-9]{2}/);
  });
});
