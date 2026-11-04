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

/** Field names that would carry a place, a device or a secret, wherever they are in the line. */
const forbiddenKeys =
  /^(lat|lon|lng|latitude|longitude|accuracy|altitude|deviceId|device_id|token)$/i;

/** Every key of a parsed line, nested objects and arrays included. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

/**
 * What a load line gives away of the fixture's places: a field that carries one, or one of its
 * coordinates written out in full, as they would be if logged. A timing or a load figure is
 * no match: only the exact digits of a coordinate are.
 */
function leaks(rawLines: readonly string[], coordinates: readonly string[]): string[] {
  const found: string[] = [];
  for (const raw of rawLines) {
    for (const key of keysOf(JSON.parse(raw)))
      if (forbiddenKeys.test(key)) found.push(`field ${key}`);
    for (const digits of coordinates) if (raw.includes(digits)) found.push(`coordinate ${digits}`);
  }
  return found;
}

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

    const logged = lines.filter((entry) => entry.includes('"msg":"load"'));
    expect(logged.length).toBeGreaterThan(0);
    const raw = logged.join("\n");
    for (const secret of [token, email, deviceName, "iphone-jens"])
      expect(raw).not.toContain(secret);
    // The fixture rides through Ghent: its coordinates, as written in the batch, in full.
    const coordinates = overlandFixture()
      .locations.flatMap((feature) => feature.geometry?.coordinates ?? [])
      .map(String);
    expect(coordinates.length).toBeGreaterThan(0);
    expect(leaks(logged, coordinates)).toEqual([]);
  });

  it("would notice a coordinate or a place in a line", () => {
    const [place] = overlandFixture().locations.flatMap((f) => f.geometry?.coordinates ?? []);
    const coordinates = [String(place)];
    const clean = JSON.stringify({ level: 30, msg: "load", points: 30, loopP99Ms: 51.034 });
    // A timing that happens to start like a place is none.
    expect(leaks([clean], coordinates)).toEqual([]);
    const written = JSON.stringify({ level: 30, msg: "load", where: `at ${place}` });
    expect(leaks([written], coordinates)).toEqual([`coordinate ${place}`]);
    const field = JSON.stringify({ level: 30, msg: "load", last: { lat: 1 } });
    expect(leaks([field], coordinates)).toEqual(["field lat"]);
  });
});
