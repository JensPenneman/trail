import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planWindow } from "../../src/processing/runPipeline";
import { signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FixtureWaySource } from "../support/fixtureWaySource";
import { morning, tramRide } from "../support/journeys";
import { uploadJourney } from "../support/overlandPoints";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * Map tiles are where someone has been: like positions, they reach the log at
 * debug level only. Above it the processing log keeps counts, times and the
 * kind of failure.
 */
let t: TestContext;
const fixture = new FixtureWaySource();
const lines: Record<string, unknown>[] = [];

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({
    waySource: fixture,
    logLevel: "debug",
    logDestination: { write: (line: string) => lines.push(JSON.parse(line)) },
  });
});

afterAll(async () => {
  await t.close();
});

/** What a line says, without the logger's own time, process id and host name. */
const said = ({ time, pid, hostname, ...rest }: Record<string, unknown>) => JSON.stringify(rest);

describe("the processing log", () => {
  it("names tiles and positions at debug level only", async () => {
    const { agent } = await signUpWithCookie(t.app, "first@example.com");
    const device = await createDevice(agent, { name: "Tram rider" });
    const points = tramRide(morning);
    const tiles = [...planWindow(points, [], t.ctx.processing.config).tiles];
    // Every other tile fails: the log gets stored tiles, failures and the window.
    for (const [index, tile] of tiles.entries()) if (index % 2 === 0) fixture.failing.add(tile);
    await uploadJourney(t.app, device.credentials.accessToken, points);
    await t.ctx.background.drain(5000);
    await t.ctx.processing.flush();

    const above = lines.filter((line) => Number(line["level"]) > 20);
    const messages = new Set(above.map((line) => line["msg"]));
    expect(messages).toContain("map tile stored");
    expect(messages).toContain("map tile could not be fetched; trying again later");
    expect(messages).toContain("processing window done");
    for (const line of above) {
      const text = said(line);
      for (const tile of tiles) expect(text).not.toContain(tile);
      expect(text).not.toMatch(/"(tile|x|y|lat|lon|latitude|longitude)"/);
      // No number with the decimals of a position.
      expect(text).not.toMatch(/\d\.\d{4,}/);
    }
    // The details are there for whoever turns debug on.
    const debug = lines.filter((line) => Number(line["level"]) === 20).map(said);
    expect(tiles.every((tile) => debug.some((text) => text.includes(`"tile":"${tile}"`)))).toBe(
      true,
    );
  });
});
