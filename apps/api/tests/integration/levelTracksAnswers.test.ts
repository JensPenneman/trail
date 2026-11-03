import { createHash } from "node:crypto";
import { apiPaths } from "@trail/contracts/apiPaths";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent } from "../support/authFlows";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { deskJitter, morning, motorwayDrive, walkTrainWalk } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { lastT } from "../support/syntheticWorld";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * The tracks at every level, byte for byte (docs/architecture.md §17.6): an
 * hour at a desk, then on foot, a train on mapped rails and on foot again, at
 * 1 Hz, and a drive on another device. The hashes were taken before the level
 * tracks' read was made cheaper (§8.10); a faster read must give the same
 * answers. Ids and stamps differ from run to run, so they are named by their
 * order before hashing.
 */
let t: TestContext;
let owner: Agent;
let commute = "";
let drive = "";

const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();
const day = { from: iso(morning - 6 * 3600), to: iso(morning + 18 * 3600) };

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ waySource: new FixtureWaySource() });
  ({ agent: owner } = await signUpWithCookie(t.app, "first@example.com"));
  const one = await createDevice(owner, { name: "Commute" });
  const two = await createDevice(owner, { name: "Car" });
  commute = one.device.id;
  drive = two.device.id;
  const desk = deskJitter(morning);
  const leaving = lastT(desk) + 300;
  await uploadJourney(t.app, one.credentials.accessToken, [...desk, ...walkTrainWalk(leaving)]);
  await uploadJourney(t.app, two.credentials.accessToken, motorwayDrive(morning + 6 * 3600));
  await t.ctx.background.drain(5000);
  await t.ctx.processing.flush();
});

afterAll(async () => {
  await t.close();
});

/** The answer with its run's ids named by their order, and without the stamps. */
function hashOf(body: unknown): string {
  const names = new Map<string, string>([
    [commute, "commute"],
    [drive, "drive"],
  ]);
  const text = JSON.stringify(body, (key, value: unknown) => {
    if (key === "stamps") return undefined;
    if (typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)) {
      if (!names.has(value)) names.set(value, `id${names.size}`);
      return names.get(value);
    }
    return value;
  });
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

describe("the level tracks", () => {
  it("are the answers they were, at every level, simplified or not", async () => {
    const hashes: Record<string, string> = {};
    for (const level of ["raw", "averaged", "mapped", "inferred"]) {
      for (const maxPoints of [8000, 300]) {
        const response = await owner
          .get(apiPaths.v1.tracks)
          .query({ ...day, level, maxPoints })
          .expect(200);
        hashes[`${level} ${maxPoints}`] = hashOf(response.body);
      }
    }
    const one = await owner
      .get(apiPaths.v1.tracks)
      .query({ ...day, level: "inferred", devices: commute })
      .expect(200);
    hashes["inferred commute"] = hashOf(one.body);
    expect(hashes).toEqual({
      "raw 8000": "3d6fb3c7acb0d46a",
      "raw 300": "998db2ea32f68b59",
      "averaged 8000": "358431328275b87b",
      "averaged 300": "7e204cf31175b678",
      "mapped 8000": "c7ab3abaf1c18dbe",
      "mapped 300": "11ee18dbf0300745",
      "inferred 8000": "57ad6bacf62ce3ab",
      "inferred 300": "0a8bc3b61f0030e9",
      "inferred commute": "90ca9f5ceb00abfd",
    });
  });
});
