import { apiPaths } from "@trail/contracts/apiPaths";
import { apiErrorSchema } from "@trail/contracts/errors";
import { personDaysResponseSchema } from "@trail/contracts/person";
import { shareResponseSchema } from "@trail/contracts/share";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "../../src/lib/calendarDate";
import { localDate } from "../../src/lib/localDate";
import { startOfLocalDay } from "../../src/lib/startOfLocalDay";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { FakeApiTokens, tokenPrincipal } from "../support/fakeApiTokens";
import { resetDatabase } from "../support/resetDatabase";
import { from } from "../support/sharingFlows";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * GET /api/v1/people/{userId}/days (docs/architecture.md §8.5): the days a
 * person recorded something, within the history they share, from the daily
 * statistics, in their time zone — and who may ask, what the access log keeps
 * and when the ETag moves.
 */
let t: TestContext;
const tokens = new FakeApiTokens();

interface Person {
  agent: Agent;
  id: string;
  email: string;
}
let owner: Person;
let ana: Person;
let eve: Person;
let phone = "";
let watch = "";
let private_ = "";
let shareId = "";

const zone = "Europe/Brussels";
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;
const now = Date.now();
const today = localDate(new Date(now), zone);
/** The share's history is 7 days: its window begins this far back. */
const windowStart = new Date(now - 7 * 86_400_000);
const firstDay = localDate(windowStart, zone);
const daysAgo = (days: number) => addDays(today, -days);

async function account(email: string): Promise<Person> {
  const { agent } = await signUpWithCookie(t.app, email);
  const session = await agent.get("/api/auth/session").expect(200);
  return { agent, id: session.body.user.id, email };
}

async function dayRow(deviceId: string, date: string, points: number) {
  const base = startOfLocalDay(date, zone);
  await t.ctx.db.execute(sql`
    INSERT INTO daily_stats (device_id, date, points, distance_m, first_at, last_at)
    VALUES (${deviceId}, ${date}::date, ${points}, 1000,
      ${new Date(base + 3_600_000).toISOString()}::timestamptz,
      ${new Date(base + 7_200_000).toISOString()}::timestamptz)
    ON CONFLICT (device_id, date) DO UPDATE SET points = EXCLUDED.points
  `);
}

const days = (agent: Agent = ana.agent) => agent.get(apiPaths.v1.people.days(owner.id));
const parsed = async () => personDaysResponseSchema.parse((await days().expect(200)).body);

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ apiTokens: tokens });
  owner = await account("first@example.com");
  ana = await account("ana@allowed.test");
  eve = await account("eve@allowed.test");
  await t.ctx.db.execute(sql`UPDATE users SET timezone = ${zone} WHERE id = ${owner.id}`);
  phone = (await createDevice(owner.agent, { name: "Phone" })).device.id;
  watch = (await createDevice(owner.agent, { name: "Watch" })).device.id;
  private_ = (await createDevice(owner.agent, { name: "Not shared" })).device.id;

  // Days with data: one outside the window, the window's first (cut by the history's start),
  // and others; the watch has one day of its own; the unshared device has days nobody may see.
  await dayRow(phone, daysAgo(9), 50);
  await dayRow(phone, firstDay, 40);
  await dayRow(phone, daysAgo(5), 12);
  await dayRow(phone, daysAgo(1), 7);
  await dayRow(phone, today, 3);
  await dayRow(watch, daysAgo(5), 2);
  await dayRow(private_, daysAgo(2), 99);
  // The window's first day, counted from the history's start only: one point before it, two after.
  for (const [deviceId, offsetS] of [
    [phone, -30],
    [phone, 30],
    [phone, 90],
  ] as const) {
    await t.ctx.db.execute(sql`
      INSERT INTO locations (device_id, recorded_at, lat, lon)
      VALUES (${deviceId}, ${new Date(windowStart.getTime() + offsetS * 1000).toISOString()}::timestamptz,
        51.05, 3.72)
    `);
  }
  shareId = shareResponseSchema.parse(
    (
      await from(owner.agent, "post", apiPaths.v1.shares.root, {
        email: ana.email,
        precision: "precise",
        duration: "indefinitely",
        deviceIds: [phone, watch],
        historyDays: 7,
      }).expect(201)
    ).body,
  ).share.id;
});

afterAll(async () => {
  await t.close();
});

describe("the days of a person who shares history", () => {
  it("lists the days of the window per shared device, in the person's time zone", async () => {
    const answer = await parsed();
    expect(answer.timezone).toBe(zone);
    expect(answer.window).toEqual({ from: firstDay, to: today });
    expect(answer.days.map((day) => [day.date, day.deviceId, day.points])).toEqual(
      [
        [firstDay, phone, 2],
        [daysAgo(5), phone, 12],
        [daysAgo(5), watch, 2],
        [daysAgo(1), phone, 7],
        [today, phone, 3],
      ].sort((a, b) =>
        String(a[0]) < String(b[0])
          ? -1
          : a[0] === b[0]
            ? String(a[1]) < String(b[1])
              ? -1
              : 1
            : 1,
      ),
    );
  });

  it("counts the first day from where the history starts, and says nothing older", async () => {
    const [first] = (await parsed()).days;
    expect(first).toMatchObject({ date: firstDay, deviceId: phone, points: 2 });
    expect(Date.parse(first?.firstAt ?? "")).toBe(windowStart.getTime() + 30_000);
    expect(Date.parse(first?.lastAt ?? "")).toBe(windowStart.getTime() + 90_000);
    for (const day of (await parsed()).days) {
      expect(Date.parse(day.firstAt)).toBeGreaterThanOrEqual(windowStart.getTime());
    }
  });

  it("holds no device that is not shared, and no coordinate", async () => {
    const body = JSON.stringify((await days().expect(200)).body);
    expect(body).not.toContain(private_);
    expect(body).not.toMatch(/"(lat|lon|latitude|longitude|points":\s*\[|centroid)/);
    expect(body).not.toMatch(/\d\.\d{4,}/);
  });
});

describe("who may ask", () => {
  it("answers 404 to someone the person does not share with, and to an unknown person", async () => {
    for (const agent of [eve.agent, owner.agent]) {
      expect(errorOf((await days(agent).expect(404)).body).code).toBe("not_found");
    }
    await ana.agent
      .get(apiPaths.v1.people.days("0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60"))
      .expect(404);
  });

  it("needs people:read: a token without it is refused, with it answers", async () => {
    const reader = `Bearer ${tokens.issue(await tokenPrincipal(t.ctx.db, ana.email, { scopes: ["people:read"] }))}`;
    const locations = `Bearer ${tokens.issue(await tokenPrincipal(t.ctx.db, ana.email, { scopes: ["locations:read"] }))}`;
    await request(t.app)
      .get(apiPaths.v1.people.days(owner.id))
      .set("Authorization", reader)
      .expect(200);
    const refused = await request(t.app)
      .get(apiPaths.v1.people.days(owner.id))
      .set("Authorization", locations)
      .expect(403);
    expect(errorOf(refused.body).code).toBe("insufficient_scope");
    await request(t.app).get(apiPaths.v1.people.days(owner.id)).expect(401);
  });

  it("is a 404 for a share without history, with less than precise positions, or that is hidden", async () => {
    const patch = (body: Record<string, unknown>) =>
      from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), body).expect(200);
    await patch({ historyDays: null });
    await days().expect(404);
    await patch({ historyDays: 7 });
    await days().expect(200);
    await patch({ precision: "approximate", historyDays: null });
    await days().expect(404);
    await patch({ precision: "precise", historyDays: 7 });
    await days().expect(200);
    await from(ana.agent, "post", apiPaths.v1.shares.hide(shareId)).expect(200);
    await days().expect(404);
    await from(ana.agent, "post", apiPaths.v1.shares.unhide(shareId)).expect(200);
    await days().expect(200);
  });

  it("is a 404 for a share that was stopped or has expired, and no days for one without devices", async () => {
    const share = async (email: string) =>
      shareResponseSchema.parse(
        (
          await from(owner.agent, "post", apiPaths.v1.shares.root, {
            email,
            precision: "precise",
            duration: "indefinitely",
            deviceIds: [phone],
            historyDays: 7,
          }).expect(201)
        ).body,
      ).share.id;
    const stopped = await account("stopped@allowed.test");
    const expiring = await account("expiring@allowed.test");
    const bare = await account("bare@allowed.test");
    const stoppedId = await share(stopped.email);
    const expiringId = await share(expiring.email);
    const bareId = await share(bare.email);
    // Its only device is gone (deleted): the share stays, with nothing to show.
    await t.ctx.db.execute(
      sql`UPDATE shares SET device_ids = ARRAY['0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60']::uuid[] WHERE id = ${bareId}`,
    );
    await days(stopped.agent).expect(200);
    await days(expiring.agent).expect(200);
    await from(owner.agent, "delete", apiPaths.v1.shares.one(stoppedId)).expect(204);
    await days(stopped.agent).expect(404);
    await t.ctx.db.execute(
      sql`UPDATE shares SET expires_at = now() - interval '1 second' WHERE id = ${expiringId}`,
    );
    await days(expiring.agent).expect(404);
    const empty = personDaysResponseSchema.parse((await days(bare.agent).expect(200)).body);
    expect(empty.days).toEqual([]);
  });

  it("follows a shorter history: one day shares fewer days", async () => {
    await from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), { historyDays: 1 }).expect(
      200,
    );
    const short = await parsed();
    expect(
      short.days
        .map((day) => day.date)
        .every((date) => date >= localDate(new Date(now - 86_400_000), zone)),
    ).toBe(true);
    expect(short.days.some((day) => day.date === daysAgo(5))).toBe(false);
    await from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), { historyDays: 7 }).expect(
      200,
    );
  });
});

describe("what the person's logs and the ETag keep", () => {
  it("writes one line to the person's data access log, with the window and not the days", async () => {
    await t.ctx.background.drain(5000);
    await t.ctx.dataAccess.flush();
    await t.ctx.db.execute(sql`DELETE FROM data_access_events`);
    await days().expect(200);
    await t.ctx.background.drain(5000);
    await t.ctx.dataAccess.flush();
    const { rows } = await t.ctx.db.execute<{ action: string; resource: Record<string, unknown> }>(
      sql`SELECT action, resource FROM data_access_events WHERE owner_user_id = ${owner.id}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("getPersonDays");
    expect(rows[0]?.resource).toEqual({
      deviceIds: expect.arrayContaining([phone, watch]),
      from: firstDay,
      to: today,
    });
    expect(JSON.stringify(rows)).not.toContain(daysAgo(5));
  });

  it("answers 304 to its own ETag, and a new one after their points or the share change", async () => {
    const first = await days().expect(200);
    const etag = String(first.headers["etag"]);
    expect(etag).toMatch(/^W\//);
    await days().set("If-None-Match", etag).expect(304);
    await dayRow(phone, today, 4);
    const afterPoints = await days().set("If-None-Match", etag).expect(200);
    const second = String(afterPoints.headers["etag"]);
    expect(second).not.toBe(etag);
    await days().set("If-None-Match", second).expect(304);
    await from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), {
      deviceIds: [phone],
    }).expect(200);
    const afterShare = await days().set("If-None-Match", second).expect(200);
    expect(String(afterShare.headers["etag"])).not.toBe(second);
    expect(
      personDaysResponseSchema.parse(afterShare.body).days.some((d) => d.deviceId === watch),
    ).toBe(false);
  });
});
