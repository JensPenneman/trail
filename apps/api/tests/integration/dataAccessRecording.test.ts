import type { Client } from "@modelcontextprotocol/client";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiTokenTemplates } from "@trail/contracts/apiToken";
import { shareResponseSchema } from "@trail/contracts/share";
import { createShareLinkResponseSchema, shareSecretHeader } from "@trail/contracts/shareLink";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createApiToken } from "../support/apiTokenFlows";
import { type Agent, signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { connectMcp } from "../support/mcpClient";
import { resetDatabase } from "../support/resetDatabase";
import { from, uploadOf } from "../support/sharingFlows";
import { SseClient } from "../support/sseClient";
import { createTestContext, type TestContext } from "../support/testContext";

/*
 * The data access log through the real app, channel by channel
 * (docs/architecture.md §8.7): what each kind of access writes, for whom,
 * and what it never writes — a coordinate, a secret, a recipient's
 * credentials or address, a link visitor's address.
 */
let t: TestContext;
const streams: SseClient[] = [];
const clients: Client[] = [];

interface Person {
  agent: Agent;
  cookie: string;
  id: string;
  email: string;
}
let owner: Person;
let ana: Person;
let phone = { id: "", token: "" };
let watch = "";

/** Where the owner's phone is: no row of the log may ever hold it. */
const exact = { lat: 51.0543117, lon: 3.7174243 };
const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const firefox =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:143.0) Gecko/20100101 Firefox/143.0";
const day = {
  from: new Date(Date.now() - 86_400_000).toISOString(),
  to: new Date(Date.now() + 3_600_000).toISOString(),
};
/** Every secret the tests see: none may reach a row. */
const secrets: string[] = [];

interface Row extends Record<string, unknown> {
  owner_user_id: string;
  count: number;
  actor_kind: string;
  channel: string;
  actor_user_id: string | null;
  actor_session_id: string | null;
  actor_token_id: string | null;
  actor_share_id: string | null;
  actor_link_id: string | null;
  actor_label: string | null;
  visitor_key: string | null;
  ip_coarse: string | null;
  ua_family: string | null;
  action: string;
  access: string;
  resource: Record<string, unknown>;
  status: number;
}

async function account(email: string): Promise<Person> {
  const { agent, cookie } = await signUpWithCookie(t.app, email);
  const session = await agent.get("/api/auth/session").expect(200);
  return { agent, cookie, email, id: session.body.user.id };
}

/** Whatever is still on its way — background work, the buffer — into the table. */
async function settle(): Promise<void> {
  await t.ctx.background.drain(5_000);
  await t.ctx.dataAccess.flush();
}

async function rowsOf(userId: string): Promise<Row[]> {
  await settle();
  const { rows } = await t.ctx.db.execute<Row>(sql`
    SELECT * FROM data_access_events WHERE owner_user_id = ${userId} ORDER BY id
  `);
  return rows;
}

/** Every row any scenario wrote, kept for the scan at the end before a scenario clears the log. */
const written: Row[] = [];

async function keepRows(): Promise<void> {
  await settle();
  written.push(...(await t.ctx.db.execute<Row>(sql`SELECT * FROM data_access_events`)).rows);
}

/** Starts a scenario with an empty log; what was in it stays for the final scan. */
async function clearLog(): Promise<void> {
  await keepRows();
  await t.ctx.db.execute(sql`DELETE FROM data_access_events`);
}

const actions = (rows: readonly Row[]) => rows.map((row) => row.action).sort();

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  owner = await account("first@example.com");
  ana = await account("ana@allowed.test");
  const created = await createDevice(owner.agent, { name: "Owner's phone" });
  phone = { id: created.device.id, token: created.credentials.accessToken };
  secrets.push(
    created.credentials.accessToken,
    owner.cookie.split("=")[1] ?? "",
    ana.cookie.split("=")[1] ?? "",
  );
  watch = (await createDevice(owner.agent, { name: "Owner's watch" })).device.id;
  await postOverland(
    t.app,
    phone.token,
    uploadOf([
      { ago: 600, ...exact },
      { ago: 30, ...exact },
    ]),
  ).expect(200);
  await settle();
});

afterAll(async () => {
  for (const client of clients) await client.close();
  for (const stream of streams) stream.close();
  await t.close();
});

describe("the owner's own browser", () => {
  it("records the dashboard's reads, by browser, with what they asked for", async () => {
    await clearLog();
    const read = (path: string, query: Record<string, string>) =>
      owner.agent.get(path).set("User-Agent", iphone).query(query).expect(200);
    await read(apiPaths.tracks, { from: day.from, to: day.to, deviceIds: phone.id });
    await read(apiPaths.tracks, { from: day.from, to: day.to, deviceIds: phone.id });
    await read(apiPaths.heatmap, { bbox: "3.6,51,3.8,51.1", zoom: "12" });
    await read(apiPaths.statsDays, { from: "2026-10-01", to: "2026-10-31" });
    await read(apiPaths.statsActivity, { hours: "24" });
    await read(apiPaths.visits, { from: day.from, to: day.to });
    await read(apiPaths.trips, { from: day.from, to: day.to });
    await read(apiPaths.locations, { deviceId: phone.id });
    await read(apiPaths.export, { from: day.from, to: day.to, format: "gpx" });
    // Through the public API with the session, as the dashboard does for the levels.
    await read(apiPaths.v1.tracks, { from: day.from, to: day.to, level: "averaged" });
    await read(apiPaths.v1.devices.mode(phone.id), {});

    const rows = await rowsOf(owner.id);
    expect(actions(rows)).toEqual([
      "dashboard.export",
      "dashboard.heatmap",
      "dashboard.locations",
      "dashboard.statsActivity",
      "dashboard.statsDays",
      "dashboard.tracks",
      "dashboard.trips",
      "dashboard.visits",
      "getDeviceMode",
      "getTracks",
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        actor_kind: "owner",
        channel: "web",
        actor_label: "Safari on iPhone",
        actor_user_id: null,
        actor_token_id: null,
        ip_coarse: null,
      });
      expect(row.actor_session_id).toMatch(/^[0-9a-f]{64}$/);
    }
    const byAction = new Map(rows.map((row) => [row.action, row]));
    expect(byAction.get("dashboard.tracks")).toMatchObject({
      count: 2,
      access: "read",
      resource: {
        deviceIds: [phone.id],
        from: new Date(day.from).toISOString(),
        to: new Date(day.to).toISOString(),
        level: "raw",
      },
    });
    expect(byAction.get("dashboard.heatmap")?.resource).toEqual({});
    expect(byAction.get("dashboard.statsDays")?.resource).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(byAction.get("dashboard.statsActivity")?.resource).toEqual({ hours: 24 });
    expect(byAction.get("dashboard.locations")?.resource).toEqual({ deviceIds: [phone.id] });
    expect(byAction.get("dashboard.export")).toMatchObject({
      access: "export",
      resource: { format: "gpx" },
    });
    expect(byAction.get("getTracks")?.resource).toMatchObject({ level: "averaged" });
    expect(byAction.get("getDeviceMode")?.resource).toEqual({ deviceIds: [phone.id] });
  });

  it("does not record the device list, the configuration, health, the session or a refused read", async () => {
    await clearLog();
    await owner.agent.get(apiPaths.devices.root).expect(200);
    await owner.agent.get(apiPaths.devices.one(phone.id)).expect(200);
    await owner.agent.get(apiPaths.config).expect(200);
    await owner.agent.get(apiPaths.health).expect(200);
    await owner.agent.get(apiPaths.auth.session).expect(200);
    await owner.agent.get(apiPaths.tracks).query({ from: day.to, to: day.from }).expect(400);
    await owner.agent
      .get(apiPaths.v1.devices.mode("0199a0f3-5fec-72ad-a30c-5ab9d8908cd9"))
      .expect(404);
    expect(await rowsOf(owner.id)).toEqual([]);
  });

  it("records changes: a mode, a deleted period, a deleted device, tokens", async () => {
    await clearLog();
    await from(owner.agent, "post", apiPaths.v1.devices.mode(phone.id), { mode: "train" }).expect(
      200,
    );
    await from(owner.agent, "post", apiPaths.deleteLocations, {
      deviceId: watch,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    }).expect(200);
    const made = await createApiToken(owner.agent, {
      name: "Short-lived",
      scopes: ["profile:read"],
      expiresAt: null,
    });
    await from(owner.agent, "patch", apiPaths.me.token(made.token.id), { name: "Renamed" }).expect(
      200,
    );
    await from(owner.agent, "post", apiPaths.me.rollToken(made.token.id)).expect(200);
    await from(owner.agent, "delete", apiPaths.me.token(made.token.id)).expect(204);
    // Already revoked: nothing changes, nothing is recorded.
    await from(owner.agent, "delete", apiPaths.me.token(made.token.id)).expect(204);
    const spare = await createDevice(owner.agent, { name: "Spare" });
    await from(owner.agent, "delete", apiPaths.devices.one(spare.device.id)).expect(204);

    const rows = await rowsOf(owner.id);
    expect(actions(rows)).toEqual([
      "dashboard.createApiToken",
      "dashboard.deleteDevice",
      "dashboard.deleteLocations",
      "dashboard.revokeApiToken",
      "dashboard.rollApiToken",
      "dashboard.updateApiToken",
      "setDeviceMode",
    ]);
    expect(rows.every((row) => row.access === "write" && row.channel === "web")).toBe(true);
    const byAction = new Map(rows.map((row) => [row.action, row]));
    expect(byAction.get("setDeviceMode")?.resource).toEqual({
      deviceIds: [phone.id],
      mode: "train",
    });
    expect(byAction.get("dashboard.deleteLocations")?.resource).toEqual({
      deviceIds: [watch],
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    });
    expect(byAction.get("dashboard.deleteDevice")).toMatchObject({
      status: 204,
      resource: { deviceIds: [spare.device.id] },
    });
    for (const action of ["createApiToken", "updateApiToken", "rollApiToken", "revokeApiToken"]) {
      expect(byAction.get(`dashboard.${action}`)?.resource).toEqual({ tokenId: made.token.id });
    }
    await from(owner.agent, "post", apiPaths.v1.devices.mode(phone.id), { mode: null }).expect(200);
  });
});

describe("the owner's API tokens", () => {
  it("record every v1 operation they call, by token, and nothing about the token itself", async () => {
    const made = await createApiToken(owner.agent, {
      name: "Home Assistant",
      scopes: ["devices:read", "locations:read", "history:read", "profile:read"],
      expiresAt: null,
    });
    secrets.push(made.secret);
    await clearLog();
    const call = (path: string, query: Record<string, string> = {}) =>
      request(t.app).get(path).set("Authorization", bearer(made.secret)).query(query).expect(200);
    for (let index = 0; index < 3; index += 1) await call(apiPaths.v1.devices.location(phone.id));
    await call(apiPaths.v1.devices.root);
    await call(apiPaths.v1.me);
    await call(apiPaths.v1.locations, { device: phone.id, from: day.from });
    await call(apiPaths.v1.heatmap, { bbox: "3.6,51,3.8,51.1", zoom: "12", devices: phone.id });
    await call(apiPaths.v1.stats.days, {
      from: "2026-10-01",
      to: "2026-10-31",
      devices: `${watch},${phone.id}`,
    });
    // Neither the token describing itself nor the public document is an access to anyone's data.
    await call(apiPaths.v1.tokens.verify);
    await request(t.app).get(apiPaths.v1.openApi).expect(200);
    await request(t.app)
      .get(apiPaths.v1.trips)
      .set("Authorization", bearer(made.secret))
      .query({ from: day.to, to: day.from })
      .expect(400);

    const rows = await rowsOf(owner.id);
    expect(actions(rows)).toEqual([
      "getDeviceLocation",
      "getHeatmap",
      "getMe",
      "listDayStats",
      "listDevices",
      "listLocations",
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        actor_kind: "token",
        channel: "api",
        actor_token_id: made.token.id,
        actor_label: "Home Assistant",
        actor_session_id: null,
        actor_user_id: null,
      });
    }
    const byAction = new Map(rows.map((row) => [row.action, row]));
    expect(byAction.get("getDeviceLocation")).toMatchObject({
      count: 3,
      resource: { deviceIds: [phone.id] },
    });
    expect(byAction.get("listLocations")?.resource).toEqual({
      deviceIds: [phone.id],
      from: new Date(day.from).toISOString(),
    });
    expect(byAction.get("getHeatmap")?.resource).toEqual({ deviceIds: [phone.id] });
    expect(byAction.get("listDayStats")?.resource).toEqual({
      deviceIds: [phone.id, watch].sort(),
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
});

describe("the MCP server", () => {
  it("records every tool call and resource read as mcp.<name>, with the devices it resolved", async () => {
    const made = await createApiToken(owner.agent, {
      name: "Calendar agent",
      scopes: [...apiTokenTemplates.agent],
      expiresAt: null,
    });
    secrets.push(made.secret);
    await clearLog();
    const { client } = await connectMcp(t.app, made.secret);
    clients.push(client);
    await client.callTool({ name: "list_devices", arguments: {} });
    // By name, as an agent may ask: the log keeps the device's id, never the name typed.
    await client.callTool({ name: "get_current_location", arguments: { device: "Owner's phone" } });
    await client.callTool({ name: "get_timeline", arguments: { from: day.from, to: day.to } });
    await client.callTool({
      name: "set_transport_mode",
      arguments: { device: phone.id, mode: "bus" },
    });
    await client.callTool({
      name: "set_transport_mode",
      arguments: { device: phone.id, mode: null },
    });
    await client.readResource({ uri: `trail://devices/${phone.id}/location` });
    // A call that fails is no access.
    const failed = await client.callTool({
      name: "get_current_location",
      arguments: { device: "Nobody's" },
    });
    expect(failed.isError).toBe(true);

    const rows = await rowsOf(owner.id);
    expect(actions(rows)).toEqual([
      "mcp.get_current_location",
      "mcp.get_timeline",
      "mcp.list_devices",
      "mcp.resource.device_location",
      "mcp.set_transport_mode",
      "mcp.set_transport_mode",
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        actor_kind: "token",
        channel: "mcp",
        actor_token_id: made.token.id,
        actor_label: "Calendar agent",
      });
    }
    const byAction = new Map(rows.map((row) => [row.action, row]));
    expect(byAction.get("mcp.get_current_location")?.resource).toEqual({ deviceIds: [phone.id] });
    expect(byAction.get("mcp.list_devices")?.resource).toEqual({});
    expect(byAction.get("mcp.get_timeline")?.resource).toEqual({
      from: new Date(day.from).toISOString(),
      to: new Date(day.to).toISOString(),
    });
    const modes = rows.filter((row) => row.action === "mcp.set_transport_mode");
    expect(modes.map((row) => [row.access, row.resource])).toEqual(
      expect.arrayContaining([
        ["write", { deviceIds: [phone.id], mode: "bus" }],
        ["write", { deviceIds: [phone.id], mode: null }],
      ]),
    );
    expect(modes).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("Owner's phone");
  });
});

describe("people the owner shares with", () => {
  let shareId = "";
  let anaToken = "";

  beforeAll(async () => {
    const share = shareResponseSchema.parse(
      (
        await from(owner.agent, "post", apiPaths.v1.shares.root, {
          email: ana.email,
          precision: "precise",
          historyDays: 7,
          duration: "indefinitely",
        }).expect(201)
      ).body,
    ).share;
    shareId = share.id;
    const made = await createApiToken(ana.agent, {
      name: "Ana's script",
      scopes: ["people:read"],
      expiresAt: null,
    });
    anaToken = made.secret;
    secrets.push(made.secret);
  });

  it("put a look into the owner's log — the person and the share, not their session or token", async () => {
    await clearLog();
    await ana.agent.get(apiPaths.v1.people.root).set("User-Agent", firefox).expect(200);
    await ana.agent.get(apiPaths.v1.people.one(owner.id)).expect(200);
    await ana.agent
      .get(apiPaths.v1.people.track(owner.id))
      .query({ from: day.from, to: day.to })
      .expect(200);
    await request(t.app)
      .get(apiPaths.v1.people.root)
      .set("Authorization", bearer(anaToken))
      .set("X-Forwarded-For", "203.0.113.77")
      .expect(200);

    const rows = await rowsOf(owner.id);
    expect(actions(rows)).toEqual(["getPerson", "getPersonTrack", "listPeople"]);
    for (const row of rows) {
      expect(row).toMatchObject({
        actor_kind: "person",
        channel: "people",
        actor_user_id: ana.id,
        actor_share_id: shareId,
        actor_label: "ana",
        actor_session_id: null,
        actor_token_id: null,
        visitor_key: null,
        ip_coarse: null,
        ua_family: null,
      });
    }
    const byAction = new Map(rows.map((row) => [row.action, row]));
    // Her browser and her script are one person: one row, counted twice.
    expect(byAction.get("listPeople")).toMatchObject({
      count: 2,
      resource: { deviceIds: [phone.id, watch].sort(), precision: "precise" },
    });
    expect(byAction.get("getPersonTrack")?.resource).toMatchObject({
      deviceIds: [phone.id, watch].sort(),
      to: new Date(day.to).toISOString(),
    });
    const all = JSON.stringify(rows);
    expect(all).not.toContain("203.0.113");
    expect(all).not.toContain("Firefox");
    // Her own log holds nothing: she read nothing of her own.
    expect(await rowsOf(ana.id)).toEqual([]);
  });

  it("cannot be forged by a page of another site that sends her browser to the track", async () => {
    await clearLog();
    const stamped = async () =>
      (
        await t.ctx.db.execute<{ at: string | null }>(sql`
        SELECT last_viewed_at::text AS at FROM shares WHERE id = ${shareId}
      `)
      ).rows[0]?.at ?? null;
    await t.ctx.db.execute(sql`UPDATE shares SET last_viewed_at = NULL WHERE id = ${shareId}`);
    // What a link or an image on another site does: a GET with the cookie, no Origin.
    for (const site of ["cross-site", "same-site"]) {
      await ana.agent
        .get(apiPaths.v1.people.track(owner.id))
        .query({ from: day.from, to: day.to })
        .set("Sec-Fetch-Site", site)
        .expect(403);
    }
    expect(await rowsOf(owner.id)).toEqual([]);
    expect(await stamped()).toBeNull();
  });

  it("counts an agent's get_people for each person shown", async () => {
    const agentToken = await createApiToken(ana.agent, {
      name: "Ana's agent",
      scopes: [...apiTokenTemplates.agent],
      expiresAt: null,
    });
    secrets.push(agentToken.secret);
    await clearLog();
    const { client } = await connectMcp(t.app, agentToken.secret);
    clients.push(client);
    await client.callTool({ name: "get_people", arguments: {} });
    const rows = await rowsOf(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "mcp.get_people",
      actor_kind: "person",
      channel: "people",
      actor_user_id: ana.id,
      actor_share_id: shareId,
      actor_token_id: null,
    });
    expect(await rowsOf(ana.id)).toEqual([]);
  });

  it("count the live positions a person's open page receives, per hour", async () => {
    await clearLog();
    const stream = await SseClient.connect(t.app, ana.cookie);
    streams.push(stream);
    await stream.waitFor("hello");
    await postOverland(t.app, phone.token, uploadOf([{ ago: 20, ...exact }])).expect(200);
    await postOverland(t.app, phone.token, uploadOf([{ ago: 10, ...exact }])).expect(200);
    await stream.waitFor("person");
    const rows = await rowsOf(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "live.position",
      channel: "live",
      actor_kind: "person",
      actor_user_id: ana.id,
      actor_share_id: shareId,
      actor_label: "ana",
      count: 2,
      resource: { deviceIds: [phone.id], precision: "precise" },
    });
    stream.close();
  });

  it("record the share's lifecycle as the owner's own changes", async () => {
    await clearLog();
    await from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), {
      precision: "precise",
      historyDays: 1,
    }).expect(200);
    await ana.agent
      .post(apiPaths.v1.shares.hide(shareId))
      .set("Origin", "http://localhost:5173")
      .expect(200);
    await ana.agent
      .post(apiPaths.v1.shares.unhide(shareId))
      .set("Origin", "http://localhost:5173")
      .expect(200);
    const rows = await rowsOf(owner.id);
    expect(rows.map((row) => [row.action, row.access, row.resource])).toEqual([
      ["updateShare", "write", { historyDays: 1, precision: "precise", shareId }],
    ]);
    // Hiding is the recipient's own business: her log, not the owner's.
    expect(actions(await rowsOf(ana.id))).toEqual(["hideIncomingShare", "unhideIncomingShare"]);
  });
});

describe("public links", () => {
  let secret = "";
  let linkId = "";

  beforeAll(async () => {
    await clearLog();
    const made = createShareLinkResponseSchema.parse(
      (
        await from(owner.agent, "post", apiPaths.v1.shareLinks.root, {
          label: "On the way home",
          precision: "precise",
          historyDays: 1,
          deviceIds: [phone.id],
        }).expect(201)
      ).body,
    );
    secret = made.secret;
    linkId = made.link.id;
    secrets.push(secret);
  });

  const view = (ip: string, userAgent: string) =>
    request(t.app)
      .get(apiPaths.publicShare)
      .set(shareSecretHeader, secret)
      .set("X-Forwarded-For", ip)
      .set("User-Agent", userAgent)
      .expect(200);

  it("record making the link with its id, never its secret", async () => {
    const rows = await rowsOf(owner.id);
    expect(rows.map((row) => [row.action, row.resource])).toEqual([
      ["createShareLink", { deviceIds: [phone.id], historyDays: 1, linkId, precision: "precise" }],
    ]);
  });

  it("count each visitor's views per hour, as a network and a kind of browser", async () => {
    await clearLog();
    await view("81.82.83.84", iphone);
    await view("81.82.83.200", iphone);
    await view("2001:db8:1234:5678::9", firefox);
    // An address the app cannot read (a broken proxy) still counts, without a network.
    await view("not-an-address", iphone);

    const rows = await rowsOf(owner.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        action: "link.view",
        channel: "link",
        actor_kind: "link",
        actor_link_id: linkId,
        actor_label: "On the way home",
        resource: { deviceIds: [phone.id], historyDays: 1, precision: "precise" },
      });
      expect(row.visitor_key).toMatch(/^[0-9a-f]{16}$/);
    }
    const byNetwork = new Map(rows.map((row) => [row.ip_coarse, row]));
    expect(byNetwork.get("81.82.83.0/24")).toMatchObject({
      count: 2,
      ua_family: "iPhone · Safari",
    });
    expect(byNetwork.get("2001:db8:1234::/48")).toMatchObject({
      count: 1,
      ua_family: "Mac · Firefox",
    });
    expect(byNetwork.get(null)).toMatchObject({ count: 1, ua_family: "iPhone · Safari" });
    const keys = rows.map((row) => row.visitor_key);
    expect(new Set(keys).size).toBe(3);
    const all = JSON.stringify(rows);
    for (const address of ["81.82.83.84", "81.82.83.200", "2001:db8:1234:5678"]) {
      expect(all).not.toContain(address);
    }
  });

  it("gives the same visitor the same key later, and counts nothing for an ended link", async () => {
    const before = (await rowsOf(owner.id)).find(
      (row) => row.ip_coarse === "81.82.83.0/24",
    )?.visitor_key;
    await clearLog();
    await view("81.82.83.9", iphone);
    const after = (await rowsOf(owner.id)).find(
      (row) => row.ip_coarse === "81.82.83.0/24",
    )?.visitor_key;
    expect(after).toBe(before);

    await clearLog();
    await from(owner.agent, "delete", apiPaths.v1.shareLinks.one(linkId)).expect(204);
    await request(t.app).get(apiPaths.publicShare).set(shareSecretHeader, secret).expect(404);
    const rows = await rowsOf(owner.id);
    expect(rows.map((row) => [row.action, row.resource])).toEqual([
      ["deleteShareLink", { linkId }],
    ]);
  });
});

describe("every row", () => {
  it("holds no coordinate, no secret and no network address but a link visitor's coarse one", async () => {
    await keepRows();
    // Every row of every scenario, as each one was before the next cleared the log.
    const rows = written;
    expect(new Set(rows.map((row) => row.channel))).toEqual(
      new Set(["web", "api", "mcp", "people", "live", "link"]),
    );
    const all = JSON.stringify(rows);
    for (const value of [exact.lat, exact.lon]) {
      expect(all).not.toContain(String(value));
      // Rounded to about 10 m, too: a coordinate cut short is still a place. (Seven characters,
      // so that the seconds of a timestamp, "…:51.054Z", can never look like one.)
      expect(all).not.toContain(String(value).slice(0, 7));
    }
    for (const secret of secrets.filter((value) => value.length > 0)) {
      expect(all).not.toContain(secret);
      expect(all).not.toContain(secret.slice(-12));
    }
    expect(all).not.toMatch(/trlk_|trls_/);
    for (const row of rows) {
      if (row.actor_kind !== "link")
        expect([row.visitor_key, row.ip_coarse, row.ua_family]).toEqual([null, null, null]);
      expect(Object.keys(row.resource).every((key) => !/lat|lon|bbox|coordinate/i.test(key))).toBe(
        true,
      );
    }
  });
});
