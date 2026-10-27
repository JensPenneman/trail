import { apiPaths } from "@trail/contracts/apiPaths";
import type { ApiScope } from "@trail/contracts/apiScope";
import { apiTokenTemplates } from "@trail/contracts/apiToken";
import {
  type DataAccessEvent,
  dataAccessLogResponseSchema,
  dataAccessSummarySchema,
} from "@trail/contracts/dataAccess";
import { apiErrorSchema } from "@trail/contracts/errors";
import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccessRecord } from "../../src/dataAccess/accessRecord";
import { pruneExpiredData } from "../../src/jobs/pruneExpiredData";
import { hashToken } from "../../src/lib/hashToken";
import { localDate } from "../../src/lib/localDate";
import { shutdown } from "../../src/server/shutdown";
import { bearer, createApiToken } from "../support/apiTokenFlows";
import { type Agent, signInWithCookie, signUpWithCookie } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { from } from "../support/sharingFlows";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import { testDatabaseUrl } from "../support/testEnvironment";

/*
 * Reading the data access log (docs/architecture.md §8.7): the list and the
 * summary, for the owner alone and with `audit:read` only, names as they are
 * now or as they were, pages that hold still, the retention, the account's
 * deletion and the shutdown's last write.
 */
let t: TestContext;

interface Person {
  agent: Agent;
  cookie: string;
  id: string;
  email: string;
  sessionId: string;
  authenticator: SoftwareAuthenticator;
}
let owner: Person;
let ana: Person;
let eve: Person;
let phone = "";
/** A second browser of the owner's, signed out later. */
let laptopSession = "";
const tokens = { reader: { id: "", secret: "" }, agent: "", readOnly: "", limited: "" };
let linkId = "";
let shareId = "";

const hour = 3_600_000;
/** Exactly on an hour, so the tests know which rows share one. */
const thisHour = Math.floor(Date.now() / hour) * hour;
const ago = (hours: number, minutes = 0) => new Date(thisHour - hours * hour + minutes * 60_000);

const sessionIdOf = (cookie: string) => hashToken(cookie.slice(cookie.indexOf("=") + 1));

async function account(email: string): Promise<Person> {
  const authenticator = new SoftwareAuthenticator();
  const { agent, cookie } = await signUpWithCookie(t.app, email, authenticator);
  const session = await agent.get("/api/auth/session").expect(200);
  return {
    agent,
    cookie,
    email,
    id: session.body.user.id,
    sessionId: sessionIdOf(cookie),
    authenticator,
  };
}

const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;

async function listWith(credential: Agent | string, query: Record<string, string> = {}) {
  const call =
    typeof credential === "string"
      ? request(t.app).get(apiPaths.v1.accessLog.root).set("Authorization", bearer(credential))
      : credential.get(apiPaths.v1.accessLog.root);
  return dataAccessLogResponseSchema.parse((await call.query(query).expect(200)).body);
}

/** The actions of each hour, newest hour first; within an hour the order is the database's own. */
function byHour(items: readonly DataAccessEvent[]): string[][] {
  const hours: { bucket: string; actions: string[] }[] = [];
  for (const item of items) {
    const last = hours.at(-1);
    if (last?.bucket === item.bucketStart) last.actions.push(item.action);
    else hours.push({ bucket: item.bucketStart, actions: [item.action] });
  }
  expect(hours.map((entry) => Date.parse(entry.bucket))).toEqual(
    hours.map((entry) => Date.parse(entry.bucket)).sort((a, b) => b - a),
  );
  return hours.map((entry) => entry.actions.sort());
}

/** Every line of the owner's log, page by page. */
async function everything(query: Record<string, string> = {}): Promise<DataAccessEvent[]> {
  const items: DataAccessEvent[] = [];
  let cursor: string | null = null;
  do {
    const page = await listWith(owner.agent, {
      ...query,
      limit: "200",
      ...(cursor === null ? {} : { cursor }),
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

async function summaryWith(credential: Agent | string, days?: string) {
  const call =
    typeof credential === "string"
      ? request(t.app).get(apiPaths.v1.accessLog.summary).set("Authorization", bearer(credential))
      : credential.get(apiPaths.v1.accessLog.summary);
  const response = await call.query(days === undefined ? {} : { days }).expect(200);
  return dataAccessSummarySchema.parse(response.body);
}

function seed(records: readonly AccessRecord[]): Promise<void> {
  for (const record of records) t.ctx.dataAccess.record(record);
  return t.ctx.dataAccess.flush();
}

const browser = () => ({
  kind: "owner" as const,
  sessionId: owner.sessionId,
  label: "Safari on iPhone",
});

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = await account("first@example.com");
  ana = await account("ana@allowed.test");
  eve = await account("eve@allowed.test");
  laptopSession = sessionIdOf(
    (await signInWithCookie(t.app, owner.authenticator, owner.email)).cookie,
  );
  phone = (await createDevice(owner.agent, { name: "Owner's phone" })).device.id;
  const issue = async (name: string, scopes: ApiScope[], deviceIds: string[] | null = null) =>
    createApiToken(owner.agent, { name, scopes, deviceIds, expiresAt: null });
  const reader = await issue("Reader", ["audit:read", "profile:read"]);
  tokens.reader = { id: reader.token.id, secret: reader.secret };
  tokens.agent = (await issue("Agent", [...apiTokenTemplates.agent])).secret;
  tokens.readOnly = (await issue("Read-only", [...apiTokenTemplates["read-only"]])).secret;
  tokens.limited = (await issue("One device", ["audit:read"], [phone])).secret;
  shareId = (
    await from(owner.agent, "post", apiPaths.v1.shares.root, {
      email: ana.email,
      precision: "approximate",
      duration: "indefinitely",
    }).expect(201)
  ).body.share.id;
  linkId = (
    await from(owner.agent, "post", apiPaths.v1.shareLinks.root, {
      label: "Weekend",
      precision: "area",
    }).expect(201)
  ).body.link.id;
  // What the setup itself recorded (the tokens, the share, the link): a clean start.
  await t.ctx.dataAccess.flush();
  await t.ctx.db.execute(sql`DELETE FROM data_access_events`);

  const token = { kind: "token" as const, tokenId: tokens.reader.id, label: "Reader" };
  const person = { kind: "person" as const, userId: ana.id, shareId, label: "ana" };
  // The name the link had then; it is called "Weekend" now.
  const visitor = (ipCoarse: string, uaFamily: string) => ({
    kind: "link" as const,
    linkId,
    label: "Weekend trip",
    visitor: { ipCoarse, uaFamily },
  });
  const base = { ownerUserId: owner.id, access: "read" as const, status: 200 };
  const live = (minute: number): AccessRecord => ({
    ...base,
    channel: "live",
    actor: person,
    action: "live.position",
    resource: { deviceIds: [phone], precision: "approximate" },
    at: ago(24, minute),
  });
  const view = (actor: ReturnType<typeof visitor>, at: Date): AccessRecord => ({
    ...base,
    channel: "link",
    actor,
    action: "link.view",
    resource: { precision: "area" },
    at,
  });
  await seed([
    {
      ...base,
      channel: "web",
      actor: browser(),
      action: "dashboard.tracks",
      resource: { level: "raw" },
      at: ago(0, 5),
    },
    {
      ...base,
      channel: "web",
      actor: browser(),
      action: "dashboard.export",
      access: "export",
      resource: { format: "gpx" },
      at: ago(0, 6),
    },
    {
      ...base,
      channel: "api",
      actor: token,
      action: "getTracks",
      resource: { deviceIds: [phone] },
      at: ago(48),
    },
    {
      ...base,
      channel: "mcp",
      actor: token,
      action: "mcp.get_timeline",
      resource: {},
      at: ago(47),
    },
    ...[0, 1, 2, 3, 4].map(live),
    {
      ...base,
      channel: "people",
      actor: person,
      action: "listPeople",
      resource: { deviceIds: [phone] },
      at: ago(1),
    },
    view(visitor("81.82.83.0/24", "iPhone · Safari"), ago(2)),
    view(visitor("81.82.83.0/24", "iPhone · Safari"), ago(2, 30)),
    view(visitor("2001:db8:1234::/48", "Mac · Firefox"), ago(2, 40)),
    // Forty days ago, from the laptop: outside a summary of 30 days, inside one of 90.
    {
      ...base,
      channel: "web",
      actor: { kind: "owner", sessionId: laptopSession, label: "Firefox on Mac" },
      action: "dashboard.visits",
      resource: {},
      at: ago(40 * 24),
    },
    // Someone else's log.
    {
      ...base,
      ownerUserId: eve.id,
      channel: "web",
      actor: { kind: "owner", sessionId: eve.sessionId, label: "Firefox on Mac" },
      action: "dashboard.tracks",
      resource: {},
      at: ago(3),
    },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("the list", () => {
  it("has the owner's lines, newest hour first, each with its actor and what it read", async () => {
    const items = await everything();
    expect(byHour(items)).toEqual([
      ["dashboard.export", "dashboard.tracks"],
      ["listPeople"],
      ["link.view", "link.view"],
      ["live.position"],
      ["mcp.get_timeline"],
      ["getTracks"],
      ["dashboard.visits"],
    ]);
    expect(items.find((item) => item.action === "live.position")).toEqual({
      id: expect.stringMatching(/^\d+\.[A-Za-z0-9_-]{43}$/),
      bucketStart: ago(24).toISOString(),
      firstAt: ago(24, 0).toISOString(),
      lastAt: ago(24, 4).toISOString(),
      count: 5,
      actorKind: "person",
      channel: "live",
      actor: { kind: "person", userId: ana.id, displayName: "ana", shareId },
      action: "live.position",
      access: "read",
      resource: { deviceIds: [phone], precision: "approximate" },
      status: 200,
    });
    expect(items.find((item) => item.action === "getTracks")?.actor).toEqual({
      kind: "token",
      tokenId: tokens.reader.id,
      tokenName: "Reader",
    });
    // A browser that is still signed in is named as its session names it now.
    expect(items.find((item) => item.action === "dashboard.tracks")?.actor).toEqual({
      kind: "owner",
      sessionLabel: "Unknown browser",
    });
    const views = items.filter((item) => item.action === "link.view");
    const visitorOf = (item: DataAccessEvent) =>
      item.actor.kind === "link" ? item.actor.visitor : null;
    expect(
      views
        .map((item) => [item.count, visitorOf(item)?.ipCoarse, visitorOf(item)?.uaFamily])
        .sort(),
    ).toEqual([
      [1, "2001:db8:1234::/48", "Mac · Firefox"],
      [2, "81.82.83.0/24", "iPhone · Safari"],
    ]);
    for (const item of views) {
      expect(item.actor).toMatchObject({ kind: "link", linkId, linkLabel: "Weekend" });
      expect(visitorOf(item)?.key).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("filters by kinds of actor, channels, action and period", async () => {
    const others = await everything({ actor: "person,link,token" });
    expect(others).toHaveLength(6);
    expect(others.every((item) => item.actorKind !== "owner")).toBe(true);
    expect((await everything({ channel: "mcp" })).map((item) => item.action)).toEqual([
      "mcp.get_timeline",
    ]);
    expect((await everything({ channel: "live,people" })).map((item) => item.action)).toEqual([
      "listPeople",
      "live.position",
    ]);
    expect((await everything({ action: "link.view" })).map((item) => item.action)).toEqual([
      "link.view",
      "link.view",
    ]);
    // `from` takes in the hour it falls in, `to` ends before its own.
    const recent = await everything({ from: ago(2, 30).toISOString() });
    expect(byHour(recent)).toEqual([
      ["dashboard.export", "dashboard.tracks"],
      ["listPeople"],
      ["link.view", "link.view"],
    ]);
    const window = await everything({ from: ago(48).toISOString(), to: ago(24, 30).toISOString() });
    expect(window.map((item) => item.action)).toEqual([
      "live.position",
      "mcp.get_timeline",
      "getTracks",
    ]);
  });

  it("refuses filters, limits and cursors it does not know", async () => {
    const bad = async (query: Record<string, string>) =>
      errorOf((await owner.agent.get(apiPaths.v1.accessLog.root).query(query).expect(400)).body);
    expect((await bad({ actor: "admin" })).code).toBe("validation_failed");
    expect(Object.keys((await bad({ channel: "web,email" })).fields ?? {})).toEqual(["channel.1"]);
    expect((await bad({ limit: "201" })).fields).toHaveProperty("limit");
    expect((await bad({ action: "DROP TABLE" })).fields).toHaveProperty("action");
    expect(
      (await bad({ cursor: Buffer.from("not a cursor").toString("base64url") })).fields,
    ).toHaveProperty("cursor");
    expect(
      (await bad({ from: ago(1).toISOString(), to: ago(2).toISOString() })).fields,
    ).toHaveProperty("to");
  });

  it("pages with a cursor, and a line counted again meanwhile stays where it was", async () => {
    const first = await listWith(owner.agent, { limit: "3" });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    // The newest line is counted again before the next page is read.
    await seed([
      {
        ownerUserId: owner.id,
        channel: "web",
        actor: browser(),
        action: "dashboard.tracks",
        access: "read",
        resource: { level: "raw" },
        status: 200,
        at: ago(0, 50),
      },
    ]);
    const seen = first.items.map((item) => item.id);
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const page = await listWith(owner.agent, { limit: "3", cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
    expect((await everything()).find((item) => item.action === "dashboard.tracks")).toMatchObject({
      count: 2,
      lastAt: ago(0, 50).toISOString(),
    });
  });

  it("gives away nothing of the table's sequence in its ids and cursors", async () => {
    // The table's identity counts the rows of every account: its gaps would tell an owner how
    // much everyone else is read. An id is the line's hour and dedupe key, a cursor the same.
    const page = await listWith(owner.agent, { limit: "2" });
    const keys = await t.ctx.db.execute<{ bucket: string; key: string }>(sql`
      SELECT bucket_start::text AS bucket, dedupe_key AS key FROM data_access_events
      WHERE owner_user_id = ${owner.id}
    `);
    const known = new Set(
      keys.rows.map((row) => `${new Date(row.bucket).toISOString()}|${row.key}`),
    );
    for (const item of page.items) {
      const [hours = "", key = ""] = item.id.split(".");
      expect(Number(hours) * 3_600_000).toBe(Date.parse(item.bucketStart));
      expect(known.has(`${item.bucketStart}|${key}`)).toBe(true);
    }
    const last = page.items.at(-1);
    expect(Buffer.from(page.nextCursor ?? "", "base64url").toString("utf8")).toBe(
      `${last?.bucketStart}|${last?.id.split(".")[1]}`,
    );
  });

  it("does not record itself", async () => {
    await listWith(owner.agent);
    await summaryWith(owner.agent);
    await listWith(tokens.reader.secret);
    await t.ctx.dataAccess.flush();
    const { rows } = await t.ctx.db.execute(sql`
      SELECT 1 FROM data_access_events WHERE action IN ('listAccessLog', 'getAccessLogSummary')
    `);
    expect(rows).toHaveLength(0);
  });
});

describe("who may read it", () => {
  it("needs audit:read, which the Read-only template has and the Agent template has not", async () => {
    expect((await listWith(tokens.reader.secret)).items).toHaveLength(9);
    expect((await listWith(tokens.readOnly)).items).toHaveLength(9);
    for (const path of [apiPaths.v1.accessLog.root, apiPaths.v1.accessLog.summary]) {
      const refused = await request(t.app)
        .get(path)
        .set("Authorization", bearer(tokens.agent))
        .expect(403);
      expect(errorOf(refused.body).code).toBe("insufficient_scope");
      expect(refused.headers["www-authenticate"]).toContain('scope="audit:read"');
      await request(t.app).get(path).expect(401);
    }
  });

  it("refuses a token limited to some devices: the log is the whole account's", async () => {
    for (const path of [apiPaths.v1.accessLog.root, apiPaths.v1.accessLog.summary]) {
      const refused = await request(t.app)
        .get(path)
        .set("Authorization", bearer(tokens.limited))
        .expect(403);
      expect(errorOf(refused.body)).toMatchObject({
        code: "insufficient_scope",
        message: expect.stringContaining("every device"),
      });
      expect(refused.headers["www-authenticate"]).toBe(
        'Bearer realm="trail", error="insufficient_scope", scope="audit:read"',
      );
    }
  });

  it("shows nobody else anything of it, an administrator neither", async () => {
    // The owner is the server's first account, its administrator: their own log is all they see.
    expect((await owner.agent.get("/api/auth/session").expect(200)).body.user.isAdmin).toBe(true);
    const eves = await listWith(eve.agent);
    expect(eves.items.map((item) => item.action)).toEqual(["dashboard.tracks"]);
    const owners = new Set((await everything()).map((item) => item.id));
    expect(eves.items.some((item) => owners.has(item.id))).toBe(false);
    // Ana looked at the owner; what the owner's log says of her is not hers to read.
    expect((await listWith(ana.agent)).items).toEqual([]);
    expect((await summaryWith(ana.agent)).totals.events).toBe(0);
  });
});

describe("the summary", () => {
  it("sums up the period by actor, channel and day, with the owner's own activity apart", async () => {
    const summary = await summaryWith(owner.agent, "30");
    expect(summary).toMatchObject({ timezone: "Europe/Brussels", days: 30 });
    expect(Date.parse(summary.to) - Date.now()).toBeLessThan(60_000);
    // Two own reads now (one of them twice) and an export; the forty-day-old read is outside.
    expect(summary.totals).toEqual({
      events: 14,
      byActorKind: { owner: 3, person: 6, link: 3, token: 2 },
      byChannel: { web: 3, api: 1, mcp: 1, people: 1, live: 5, link: 3 },
      reads: 13,
      writes: 0,
      exports: 1,
    });
    expect(summary.series).toHaveLength(30);
    expect(summary.series.at(-1)?.date).toBe(localDate(new Date(), "Europe/Brussels"));
    expect(summary.series.reduce((sum, entry) => sum + entry.events, 0)).toBe(14);
    expect(summary.series.filter((entry) => entry.events > 0).length).toBeGreaterThanOrEqual(2);
    expect(summary.people).toEqual([
      {
        userId: ana.id,
        displayName: "ana",
        events: 6,
        lastAt: ago(1).toISOString(),
        actions: [
          { action: "live.position", count: 5 },
          { action: "listPeople", count: 1 },
        ],
      },
    ]);
    expect(summary.links).toEqual([
      { linkId, label: "Weekend", events: 3, visitors: 2, lastAt: ago(2, 40).toISOString() },
    ]);
    expect(summary.tokens).toEqual([
      {
        tokenId: tokens.reader.id,
        name: "Reader",
        events: 2,
        api: 1,
        mcp: 1,
        lastAt: ago(47).toISOString(),
        actions: [
          { action: "getTracks", count: 1 },
          { action: "mcp.get_timeline", count: 1 },
        ],
      },
    ]);
    expect(summary.own).toEqual({
      events: 3,
      lastAt: ago(0, 50).toISOString(),
      sessions: [{ label: "Safari on iPhone", events: 3, lastAt: ago(0, 50).toISOString() }],
    });
  });

  it("covers 7, 30 or 90 days and nothing else", async () => {
    const ninety = await summaryWith(owner.agent, "90");
    expect(ninety.series).toHaveLength(90);
    expect(ninety.own).toMatchObject({ events: 4 });
    expect(ninety.own.sessions.map((session) => session.label)).toEqual([
      "Safari on iPhone",
      "Firefox on Mac",
    ]);
    const seven = await summaryWith(tokens.reader.secret, "7");
    expect(seven.series).toHaveLength(7);
    expect(seven.days).toBe(7);
    expect((await summaryWith(owner.agent)).days).toBe(30);
    await owner.agent.get(apiPaths.v1.accessLog.summary).query({ days: "5" }).expect(400);
  });
});

describe("names", () => {
  it("are the actors' current ones while they exist, and the ones they had once they are gone", async () => {
    await from(owner.agent, "patch", apiPaths.me.token(tokens.reader.id), {
      name: "Reader renamed",
    }).expect(200);
    await from(ana.agent, "patch", apiPaths.me.root, { displayName: "Ana Lopez" }).expect(200);
    const now = await everything();
    expect(now.find((item) => item.action === "getTracks")?.actor).toMatchObject({
      tokenName: "Reader renamed",
    });
    expect(now.find((item) => item.action === "live.position")?.actor).toMatchObject({
      displayName: "Ana Lopez",
    });
    expect(now.find((item) => item.action === "dashboard.visits")?.actor).toEqual({
      kind: "owner",
      sessionLabel: "Unknown browser",
    });

    // Gone: the token pruned, Ana's account deleted, the link pruned, the laptop signed out.
    await t.ctx.db.execute(sql`DELETE FROM api_tokens WHERE id = ${tokens.reader.id}`);
    await from(ana.agent, "delete", apiPaths.me.root, { confirmEmail: ana.email }).expect(204);
    await t.ctx.db.execute(sql`DELETE FROM share_links WHERE id = ${linkId}`);
    await from(owner.agent, "delete", apiPaths.me.session(laptopSession)).expect(204);
    const later = await everything();
    expect(later.find((item) => item.action === "getTracks")?.actor).toEqual({
      kind: "token",
      tokenId: tokens.reader.id,
      tokenName: "Reader",
    });
    expect(later.find((item) => item.action === "live.position")?.actor).toEqual({
      kind: "person",
      userId: ana.id,
      displayName: "ana",
      shareId,
    });
    expect(later.find((item) => item.action === "link.view")?.actor).toMatchObject({
      linkId,
      linkLabel: "Weekend trip",
    });
    expect(later.find((item) => item.action === "dashboard.visits")?.actor).toEqual({
      kind: "owner",
      sessionLabel: "Firefox on Mac",
    });
  });
});

describe("retention", () => {
  it("prunes hours older than DATA_ACCESS_RETENTION_DAYS and keeps the rest", async () => {
    await t.ctx.dataAccess.flush();
    const count = async () =>
      Number(
        (await t.ctx.db.execute(sql`SELECT count(*)::int AS n FROM data_access_events`)).rows[0]?.[
          "n"
        ],
      );
    const before = await count();
    expect(
      (await pruneExpiredData(t.ctx.db, { dataAccessRetentionDays: 365 })).dataAccessEvents,
    ).toBe(0);
    expect(
      (await pruneExpiredData(t.ctx.db, { dataAccessRetentionDays: 30 })).dataAccessEvents,
    ).toBe(1);
    expect(await count()).toBe(before - 1);
    expect((await everything()).some((item) => item.action === "dashboard.visits")).toBe(false);
  });

  it("goes with the account", async () => {
    await from(eve.agent, "delete", apiPaths.me.root, { confirmEmail: eve.email }).expect(204);
    const { rows } = await t.ctx.db.execute(
      sql`SELECT 1 FROM data_access_events WHERE owner_user_id = ${eve.id}`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("shutting down", () => {
  it("writes what is still waiting before the pool closes", async () => {
    // A context of its own: the shutdown closes its pool.
    const other = await createTestContext();
    const { agent } = await signUpWithCookie(other.app, "late@allowed.test");
    await agent.get(apiPaths.statsActivity).query({ hours: "6" }).expect(200);
    await shutdown({ server: other.app, ctx: other.ctx, jobs: { stop: async () => {} } });
    const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
    try {
      const { rows } = await pool.query(
        `SELECT e.action, e.count, e.resource FROM data_access_events e
         JOIN users u ON u.id = e.owner_user_id WHERE u.email = 'late@allowed.test'`,
      );
      expect(rows).toEqual([
        { action: "dashboard.statsActivity", count: 1, resource: { hours: 6 } },
      ]);
    } finally {
      await pool.end();
    }
  });
});
