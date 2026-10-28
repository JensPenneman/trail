import { apiPaths } from "@trail/contracts/apiPaths";
import { peopleResponseSchema } from "@trail/contracts/person";
import { sessionResponseSchema } from "@trail/contracts/user";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/runCli";
import type { LoadFleet } from "../../src/load/createLoadFleet";
import { agentFor, signUp } from "../support/authFlows";
import { postOverland, postOwnTracks } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testEnvironment } from "../support/testEnvironment";
import {
  gpsloggerQuery,
  osmandQuery,
  owntracksIosLocation,
  traccarForm,
} from "../support/trackerSamples";

/*
 * `trail load-fleet` against the real database: refused unless every
 * condition of a load test holds (docs/perf/README.md), and otherwise people,
 * phones, sessions and shares that work like the server's own — with their
 * secrets on stdout only.
 */
const entryUrl = new URL("../../src/cli.ts", import.meta.url).href;

let t: TestContext;
let output: string[] = [];
let errors: string[] = [];
const loadTestVariables = ["LOAD_TEST", "LAUNCHWAY_ENVIRONMENT"] as const;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  for (const [key, value] of Object.entries(testEnvironment())) process.env[key] = value;
});

afterAll(async () => {
  for (const key of loadTestVariables) delete process.env[key];
  await t.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const run = async (
  environment: Partial<Record<(typeof loadTestVariables)[number], string>>,
  ...argv: string[]
) => {
  for (const key of loadTestVariables) {
    const value = environment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  output = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    output.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.map(String).join(" "));
  });
  return runCli(["load-fleet", ...argv], entryUrl);
};

const counts = async () => {
  const result = await t.ctx.db.execute<{ users: number; devices: number; sessions: number }>(sql`
    SELECT (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM devices) AS devices,
      (SELECT count(*)::int FROM sessions) AS sessions
  `);
  return result.rows[0];
};

/** Everything secret or personal of a fleet: none of it may appear in a log line. */
const secretsOf = async (fleet: LoadFleet) => {
  const accounts = await t.ctx.db.execute<{ email: string; display_name: string }>(
    sql`SELECT email, display_name FROM users`,
  );
  return [
    ...fleet.people.flatMap((person) => [
      person.session,
      ...person.devices.flatMap((device) => [device.token, device.deviceKey]),
    ]),
    ...accounts.rows.flatMap((row) => [row.email, row.display_name]),
  ];
};

describe("trail load-fleet", () => {
  it("refuses without LOAD_TEST=true, and in production, before it writes a row", async () => {
    expect(await run({}, "--people", "10")).toBe(1);
    expect(errors.join("\n")).toContain("trail load-fleet: refused: LOAD_TEST is not true");
    expect(await run({ LOAD_TEST: "false" }, "--people", "10")).toBe(1);
    expect(
      await run({ LOAD_TEST: "true", LAUNCHWAY_ENVIRONMENT: "production" }, "--people", "10"),
    ).toBe(1);
    expect(errors.join("\n")).toContain("LAUNCHWAY_ENVIRONMENT is production");
    expect(output).toEqual([]);
    expect(await counts()).toEqual({ users: 0, devices: 0, sessions: 0 });
  });

  it("refuses wrong options and a terminal for its secrets", async () => {
    expect(await run({ LOAD_TEST: "true" })).toBe(2);
    expect(await run({ LOAD_TEST: "true" }, "--people", "10", "--mix", "scenario-c")).toBe(2);
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      expect(await run({ LOAD_TEST: "true" }, "--people", "10")).toBe(2);
      expect(errors.join("\n")).toContain("redirect it to a file");
    } finally {
      if (isTTY === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY;
      else Object.defineProperty(process.stdout, "isTTY", isTTY);
    }
    expect(await counts()).toEqual({ users: 0, devices: 0, sessions: 0 });
  });

  it("creates people whose phones, sessions and shares work, its secrets on stdout only", async () => {
    expect(
      await run(
        { LOAD_TEST: "true", LAUNCHWAY_ENVIRONMENT: "preview" },
        "--people",
        "10",
        "--probe",
      ),
    ).toBe(0);
    expect(output).toHaveLength(1);
    const fleet = JSON.parse(output[0] ?? "") as LoadFleet;
    expect(fleet).toMatchObject({ format: "trail-load-fleet/1", mix: "default", shares: 6 });
    expect(fleet.people).toHaveLength(11);
    expect(
      fleet.people.filter((person) => person.probe).map((person) => person.devices[0]?.profile),
    ).toEqual(["probe"]);
    expect(
      new Set(fleet.people.flatMap((person) => person.devices.map((device) => device.app))),
    ).toEqual(new Set(["overland", "owntracks", "traccar", "osmand", "gpslogger"]));
    expect(await counts()).toEqual({ users: 11, devices: 11, sessions: 11 });
    expect(errors).toEqual(["load-fleet: 11 people, 11 phones, 11 sessions and 6 shares created"]);
    for (const secret of await secretsOf(fleet)) expect(errors.join("\n")).not.toContain(secret);

    const phone = (profile: string) => {
      const device = fleet.people
        .flatMap((person) => person.devices)
        .find((entry) => entry.profile === profile);
      if (device === undefined) throw new Error(`no ${profile} in the fleet`);
      return device;
    };
    const fixture = overlandFixture();
    const overland = await postOverland(
      t.app,
      phone("overland-high-resolution").token,
      fixture,
    ).expect(200);
    expect(overland.body).toEqual({ result: "ok" });
    await postOwnTracks(
      t.app,
      phone("owntracks-android").token,
      owntracksIosLocation(new Date()),
    ).expect(200);
    await request(t.app)
      .post(apiPaths.owntracks)
      .set("Authorization", `Bearer ${phone("probe").token}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(owntracksIosLocation(new Date())))
      .expect(200, []);
    await request(t.app)
      .post(apiPaths.osmand)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(traccarForm(phone("traccar").token, new Date()))
      .expect(200);
    await request(t.app)
      .get(`${apiPaths.osmand}?${osmandQuery(phone("osmand").token, new Date())}`)
      .expect(200);
    await request(t.app)
      .get(`${apiPaths.osmand}?${gpsloggerQuery(new Date())}`)
      .set("Authorization", `Bearer ${phone("gpslogger").token}`)
      .expect(200);

    // A person's session signs them in; a recipient sees who shares with them.
    const recipient = fleet.people.find((person) => person.index === 4);
    if (recipient === undefined) throw new Error("no fifth person");
    const cookie = `trail_session=${recipient.session}`;
    const session = await request(t.app)
      .get(apiPaths.auth.session)
      .set("Cookie", cookie)
      .expect(200);
    expect(sessionResponseSchema.parse(session.body).user.id).toBe(recipient.userId);
    const people = await request(t.app)
      .get(apiPaths.v1.people.root)
      .set("Cookie", cookie)
      .expect(200);
    // Person 3 of every ten shares with the next two: the fifth person sees the fourth.
    const sharer = fleet.people.find((person) => person.index === 3);
    expect(peopleResponseSchema.parse(people.body).people.map((person) => person.userId)).toEqual([
      sharer?.userId,
    ]);
  });

  it("runs again beside its own accounts, and is refused once someone has signed in", async () => {
    expect(await run({ LOAD_TEST: "true" }, "--people", "3", "--shares", "0")).toBe(0);
    expect(await counts()).toEqual({ users: 14, devices: 14, sessions: 14 });

    await signUp(agentFor(t.app), new SoftwareAuthenticator(), "first@example.com");
    const before = await counts();
    expect(await run({ LOAD_TEST: "true" }, "--people", "10")).toBe(1);
    expect(errors.join("\n")).toContain(
      "refused: the database holds a passkey (someone has signed in here); the database holds an account outside the load test's own",
    );
    expect(output).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  it("refuses a database that holds someone's account before it migrates it", async () => {
    // Without its journal every migration would run again and fail: a refusal that comes
    // first says that the CLI never touched the schema.
    await t.ctx.db.execute(sql`ALTER TABLE drizzle.__drizzle_migrations RENAME TO journal_aside`);
    try {
      expect(await run({ LOAD_TEST: "true" }, "--people", "10")).toBe(1);
      expect(errors.join("\n")).toContain(
        "trail load-fleet: refused: the database holds a passkey",
      );
      expect(errors.join("\n")).not.toContain("already exists");
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE drizzle.journal_aside RENAME TO __drizzle_migrations`);
    }
  });
});
