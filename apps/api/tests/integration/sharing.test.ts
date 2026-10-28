import { apiPaths } from "@trail/contracts/apiPaths";
import { apiErrorSchema } from "@trail/contracts/errors";
import {
  peopleResponseSchema,
  personResponseSchema,
  personTrackResponseSchema,
} from "@trail/contracts/person";
import {
  incomingShareListResponseSchema,
  incomingShareResponseSchema,
  shareListResponseSchema,
  shareResponseSchema,
} from "@trail/contracts/share";
import {
  createShareLinkResponseSchema,
  publicShareResponseSchema,
  shareSecretHeader,
} from "@trail/contracts/shareLink";
import { sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupLockKey } from "../../src/auth/signupLock";
import { loadOverrides } from "../../src/processing/windowData";
import { resolveAccessibleDevices } from "../../src/sharing/accessibleDevices";
import { loadCurrentModes } from "../../src/sharing/currentModes";
import { haversineM } from "../../src/tracks/haversine";
import { loadDeviceMode } from "../../src/transport/deviceMode";
import { type Agent, agentFor, signUp, signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { FakeApiTokens, tokenPrincipal } from "../support/fakeApiTokens";
import { resetDatabase } from "../support/resetDatabase";
import { from, uploadOf } from "../support/sharingFlows";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { SseClient } from "../support/sseClient";
import { createTestContext, type TestContext } from "../support/testContext";
import { testDatabaseUrl } from "../support/testEnvironment";

/*
 * Sharing with people through /api/v1 (docs/architecture.md §8.5): who sees
 * what, at which precision, for how long — and that a stopped, ended or hidden
 * share shows nothing from that moment on, in reads and in live events.
 */
let t: TestContext;
const tokens = new FakeApiTokens();
const streams: SseClient[] = [];

interface Person {
  agent: Agent;
  cookie: string;
  id: string;
  email: string;
}
let owner: Person;
let ana: Person;
let eve: Person;
let phone = { id: "", token: "" };
let watch = "";
let anaPhone = { id: "", token: "" };
let evePhone = "";

/** The owner's phone, exactly; no approximate or area answer may ever contain these. */
const exact = { lat: 51.0543117, lon: 3.7174243 };
const exactText = [String(exact.lat), String(exact.lon)];
/** Where the phone moves to later; just as secret. */
const moved = { lat: 51.0551234, lon: 3.7181234 };
const anaAt = { lat: 51.0613, lon: 3.7301 };

const errorOf = (body: unknown) => apiErrorSchema.parse(body).error;
const bearer = (secret: string) => `Bearer ${secret}`;

async function account(email: string): Promise<Person> {
  const { agent, cookie } = await signUpWithCookie(t.app, email);
  const session = await agent.get("/api/auth/session").expect(200);
  return { agent, cookie, email, id: session.body.user.id };
}

async function stream(person: Person): Promise<SseClient> {
  const client = await SseClient.connect(t.app, person.cookie);
  streams.push(client);
  await client.waitFor("hello");
  return client;
}

/** Lets the background fan-out finish, then gives the streams a moment to deliver. */
async function settle(): Promise<void> {
  await t.ctx.background.drain(5_000);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

const upload = async (token: string, points = [{ ago: 30, ...exact }]) => {
  await postOverland(t.app, token, uploadOf(points)).expect(200);
  await settle();
};

const peopleOf = async (person: Person) =>
  peopleResponseSchema.parse((await person.agent.get(apiPaths.v1.people.root).expect(200)).body)
    .people;

const shareWith = async (email: string, body: Record<string, unknown> = {}) =>
  shareResponseSchema.parse(
    (
      await from(owner.agent, "post", apiPaths.v1.shares.root, {
        email,
        precision: "precise",
        duration: "indefinitely",
        ...body,
      }).expect(201)
    ).body,
  ).share;

const stop = (shareId: string) =>
  from(owner.agent, "delete", apiPaths.v1.shares.one(shareId)).expect(204);

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ apiTokens: tokens });
  owner = await account("first@example.com");
  ana = await account("ana@allowed.test");
  eve = await account("eve@allowed.test");
  const created = await createDevice(owner.agent, { name: "Owner's phone" });
  phone = { id: created.device.id, token: created.credentials.accessToken };
  watch = (await createDevice(owner.agent, { name: "Owner's watch" })).device.id;
  const anas = await createDevice(ana.agent, { name: "Ana's phone" });
  anaPhone = { id: anas.device.id, token: anas.credentials.accessToken };
  evePhone = (await createDevice(eve.agent, { name: "Eve's phone" })).device.id;
  await upload(phone.token);
  await upload(anaPhone.token, [{ ago: 60, ...anaAt }]);
});

afterAll(async () => {
  for (const client of streams) client.close();
  await t.close();
});

describe("sharing with someone who has an account", () => {
  let shareId = "";

  it("starts at once and shows on both sides", async () => {
    const share = await shareWith(ana.email);
    shareId = share.id;
    expect(share).toMatchObject({
      status: "active",
      recipient: { email: ana.email, userId: ana.id, displayName: "ana" },
      deviceIds: null,
      precision: "precise",
      historyDays: null,
      includeDetails: true,
      expiresAt: null,
      lastViewedAt: null,
    });
    const listed = shareListResponseSchema.parse(
      (await owner.agent.get(apiPaths.v1.shares.root).expect(200)).body,
    );
    expect(listed.shares.map((entry) => entry.id)).toEqual([shareId]);
    const incoming = incomingShareListResponseSchema.parse(
      (await ana.agent.get(apiPaths.v1.shares.incoming).expect(200)).body,
    );
    expect(incoming.shares).toEqual([
      expect.objectContaining({
        id: shareId,
        owner: { userId: owner.id, displayName: "first", email: owner.email },
        hiddenAt: null,
      }),
    ]);
  });

  it("shows the owner's devices to the recipient, precisely, with details and distance", async () => {
    const [person, ...others] = await peopleOf(ana);
    expect(others).toEqual([]);
    expect(person).toMatchObject({ userId: owner.id, displayName: "first", email: owner.email });
    expect(person?.share).toMatchObject({ id: shareId, precision: "precise", historyDays: null });
    const [shownPhone, shownWatch] = person?.devices ?? [];
    expect(person?.devices.map((device) => device.id)).toEqual([phone.id, watch]);
    expect(shownPhone?.location).toMatchObject({ ...exact, altitude: 14.5, course: 123 });
    expect(shownPhone?.battery).toMatchObject({ level: 0.66, state: "unplugged" });
    expect(shownPhone?.activity).toEqual({ motion: ["walking"], tripMode: null, mode: null });
    expect(shownPhone?.distanceM).toBe(Math.round(haversineM(anaAt, exact)));
    expect(shownWatch).toMatchObject({ location: null, battery: null, distanceM: null });
  });

  it("never shows device credentials, settings or statistics", async () => {
    const response = await ana.agent.get(apiPaths.v1.people.root).expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /tokenHint|deviceKey|pendingSettings|alertsEnabled|counts|lastSeenAt|points/,
    );
    for (const device of response.body.people[0].devices) {
      expect(Object.keys(device).sort()).toEqual([
        "activity",
        "battery",
        "distanceM",
        "id",
        "location",
        "name",
      ]);
    }
  });

  it("is nobody else's business: other people see nothing and reach nothing", async () => {
    expect(await peopleOf(eve)).toEqual([]);
    expect(await peopleOf(owner)).toEqual([]);
    const notFound = async (pending: request.Test) =>
      expect(errorOf((await pending.expect(404)).body).code).toBe("not_found");
    await notFound(eve.agent.get(apiPaths.v1.people.one(owner.id)));
    await notFound(
      eve.agent.get(apiPaths.v1.people.track(owner.id)).query({
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date().toISOString(),
      }),
    );
    await notFound(
      from(eve.agent, "patch", apiPaths.v1.shares.one(shareId), { precision: "area" }),
    );
    await notFound(from(eve.agent, "delete", apiPaths.v1.shares.one(shareId)));
    await notFound(from(eve.agent, "post", apiPaths.v1.shares.hide(shareId)));
    // The recipient cannot change or stop the owner's share either, only hide it.
    await notFound(
      from(ana.agent, "patch", apiPaths.v1.shares.one(shareId), { precision: "precise" }),
    );
    await notFound(from(ana.agent, "delete", apiPaths.v1.shares.one(shareId)));
    // And the owner cannot hide their own share for the recipient.
    await notFound(from(owner.agent, "post", apiPaths.v1.shares.hide(shareId)));
    expect(
      incomingShareListResponseSchema.parse(
        (await eve.agent.get(apiPaths.v1.shares.incoming).expect(200)).body,
      ).shares,
    ).toEqual([]);
    await notFound(eve.agent.get(apiPaths.v1.people.one("not-a-uuid")));
    await notFound(from(owner.agent, "delete", apiPaths.v1.shares.one("not-a-uuid")));
  });

  it("stamps when the recipient last looked, for the owner", async () => {
    await settle();
    const [share] = shareListResponseSchema.parse(
      (await owner.agent.get(apiPaths.v1.shares.root).expect(200)).body,
    ).shares;
    expect(share?.lastViewedAt).not.toBeNull();
  });

  it("refuses what makes no sense", async () => {
    const refused = async (body: Record<string, unknown>, status: number, field?: string) => {
      const response = await from(owner.agent, "post", apiPaths.v1.shares.root, {
        email: "someone@allowed.test",
        precision: "precise",
        duration: "hour",
        ...body,
      }).expect(status);
      const error = errorOf(response.body);
      if (field !== undefined) expect(Object.keys(error.fields ?? {})).toContain(field);
      return error;
    };
    await refused({ precision: "approximate", historyDays: 7 }, 400, "historyDays");
    await refused({ precision: "area", historyDays: 1 }, 400, "historyDays");
    await refused({ email: owner.email }, 400, "email");
    await refused({ duration: "fortnight" }, 400, "duration");
    await refused({ precision: undefined }, 400, "precision");
    await refused({ historyDays: 366 }, 400, "historyDays");
    await refused({ deviceIds: [] }, 400, "deviceIds");
    expect((await refused({ deviceIds: [evePhone] }, 404)).code).toBe("not_found");
    expect((await refused({ deviceIds: ["0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"] }, 404)).code).toBe(
      "not_found",
    );
    expect((await refused({ email: ana.email }, 409)).code).toBe("conflict");
  });

  it("changes precision, history, devices and duration; history stays precise", async () => {
    const patch = (body: Record<string, unknown>) =>
      from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), body);
    const area = shareResponseSchema.parse((await patch({ precision: "area" }).expect(200)).body);
    expect(area.share.precision).toBe("area");
    const refused = await patch({ historyDays: 3 }).expect(400);
    expect(Object.keys(errorOf(refused.body).fields ?? {})).toEqual(["historyDays"]);
    const withHistory = shareResponseSchema.parse(
      (await patch({ precision: "precise", historyDays: 3 }).expect(200)).body,
    ).share;
    expect(withHistory).toMatchObject({ precision: "precise", historyDays: 3 });
    // Back to coarse without dropping history is refused too.
    await patch({ precision: "approximate" }).expect(400);
    const before = Date.now();
    const hour = shareResponseSchema.parse(
      (await patch({ duration: "hour", historyDays: null, deviceIds: [phone.id] }).expect(200))
        .body,
    ).share;
    expect(Date.parse(hour.expiresAt ?? "")).toBeGreaterThanOrEqual(before + 3_599_000);
    expect(Date.parse(hour.expiresAt ?? "")).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(hour.deviceIds).toEqual([phone.id]);
    const [person] = await peopleOf(ana);
    expect(person?.devices.map((device) => device.id)).toEqual([phone.id]);
    await patch({}).expect(400);
    await patch({ deviceIds: [evePhone] }).expect(404);
    await patch({ duration: "indefinitely", deviceIds: null }).expect(200);
  });

  it("keeps approximate and area positions coarse, in every answer", async () => {
    for (const precision of ["approximate", "area"] as const) {
      await from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), { precision }).expect(200);
      const list = await ana.agent.get(apiPaths.v1.people.root).expect(200);
      const one = await ana.agent.get(apiPaths.v1.people.one(owner.id)).expect(200);
      for (const response of [list, one]) {
        const text = JSON.stringify(response.body);
        for (const value of exactText) expect(text).not.toContain(value);
      }
      const location = personResponseSchema.parse(one.body).person.devices[0]?.location;
      expect(location).toMatchObject({
        precision,
        altitude: null,
        course: null,
        accuracy: precision === "area" ? 5560 : 556,
      });
      expect(location?.speed).toBe(precision === "area" ? null : 3.5);
      // The same answer on every read: nothing to average.
      const again = personResponseSchema.parse(
        (await ana.agent.get(apiPaths.v1.people.one(owner.id)).expect(200)).body,
      ).person.devices[0]?.location;
      expect(again).toEqual(location);
      const track = await ana.agent
        .get(apiPaths.v1.people.track(owner.id))
        .query({
          from: new Date(Date.now() - 3_600_000).toISOString(),
          to: new Date().toISOString(),
        })
        .expect(404);
      expect(errorOf(track.body).code).toBe("not_found");
    }
  });

  it("sends coarse live updates to the recipient's streams only", async () => {
    const anaStream = await stream(ana);
    const eveStream = await stream(eve);
    const ownerStream = await stream(owner);
    const seen = anaStream.events.length;
    await upload(phone.token, [{ ago: 5, ...moved }]);
    const event = await anaStream.waitFor("person", 5_000, seen);
    expect(event.userId).toBe(owner.id);
    expect(event.device).toMatchObject({ id: phone.id, name: "Owner's phone" });
    expect(event.device.location).toMatchObject({
      precision: "area",
      course: null,
      altitude: null,
    });
    const text = JSON.stringify(event);
    for (const value of [String(moved.lat), String(moved.lon)]) expect(text).not.toContain(value);
    expect(event.device.distanceM).not.toBeNull();
    expect(eveStream.events.map((entry) => entry.type)).toEqual(["hello"]);
    expect(ownerStream.events.some((entry) => entry.type === "person")).toBe(false);
    expect(ownerStream.events.some((entry) => entry.type === "ingest")).toBe(true);
  });

  it("hides a person for the recipient — nothing shown, nothing sent — and tells the owner", async () => {
    const anaStream = await stream(ana);
    const ownerStream = await stream(owner);
    const hidden = incomingShareResponseSchema.parse(
      (await from(ana.agent, "post", apiPaths.v1.shares.hide(shareId)).expect(200)).body,
    ).share;
    expect(hidden.hiddenAt).not.toBeNull();
    // Hiding twice keeps the first time.
    const twice = incomingShareResponseSchema.parse(
      (await from(ana.agent, "post", apiPaths.v1.shares.hide(shareId)).expect(200)).body,
    ).share;
    expect(twice.hiddenAt).toBe(hidden.hiddenAt);
    expect(await ownerStream.waitFor("share")).toEqual({
      type: "share",
      shareId,
      userId: ana.id,
      change: "hidden",
    });
    expect(await peopleOf(ana)).toEqual([]);
    await ana.agent.get(apiPaths.v1.people.one(owner.id)).expect(404);
    const [mine] = shareListResponseSchema.parse(
      (await owner.agent.get(apiPaths.v1.shares.root).expect(200)).body,
    ).shares;
    expect(mine?.status).toBe("hidden");
    const incoming = incomingShareListResponseSchema.parse(
      (await ana.agent.get(apiPaths.v1.shares.incoming).expect(200)).body,
    ).shares;
    expect(incoming[0]?.hiddenAt).toBe(hidden.hiddenAt);

    await upload(phone.token, [{ ago: 3, ...exact }]);
    expect(anaStream.events.some((entry) => entry.type === "person")).toBe(false);

    const told = ownerStream.events.length;
    const shown = incomingShareResponseSchema.parse(
      (await from(ana.agent, "post", apiPaths.v1.shares.unhide(shareId)).expect(200)).body,
    ).share;
    expect(shown.hiddenAt).toBeNull();
    expect((await ownerStream.waitFor("share", 5_000, told)).change).toBe("unhidden");
    expect(await peopleOf(ana)).toHaveLength(1);
    await upload(phone.token, [{ ago: 2, ...exact }]);
    await anaStream.waitFor("person");
  });

  it("stops at once: no read, no live update, and the recipient is told", async () => {
    const anaStream = await stream(ana);
    await stop(shareId);
    expect(await anaStream.waitFor("share")).toEqual({
      type: "share",
      shareId,
      userId: owner.id,
      change: "revoked",
    });
    expect(await peopleOf(ana)).toEqual([]);
    await ana.agent.get(apiPaths.v1.people.one(owner.id)).expect(404);
    expect(
      incomingShareListResponseSchema.parse(
        (await ana.agent.get(apiPaths.v1.shares.incoming).expect(200)).body,
      ).shares,
    ).toEqual([]);
    await upload(phone.token, [{ ago: 1, ...exact }]);
    expect(anaStream.events.some((entry) => entry.type === "person")).toBe(false);
    await from(owner.agent, "delete", apiPaths.v1.shares.one(shareId)).expect(404);
    await from(ana.agent, "post", apiPaths.v1.shares.hide(shareId)).expect(404);
    expect(
      shareListResponseSchema.parse(
        (await owner.agent.get(apiPaths.v1.shares.root).expect(200)).body,
      ).shares,
    ).toEqual([]);
  });

  it("ends by itself, and an ended share makes room for a new one", async () => {
    const share = await shareWith(ana.email, { duration: "hour" });
    expect(await peopleOf(ana)).toHaveLength(1);
    // An hour passes: the share's end moves into the past (the cache would hold the real end).
    await t.ctx.db.execute(
      sql`UPDATE shares SET expires_at = now() - interval '1 second' WHERE id = ${share.id}`,
    );
    t.ctx.sharing.forget(owner.id);
    expect(await peopleOf(ana)).toEqual([]);
    await ana.agent.get(apiPaths.v1.people.one(owner.id)).expect(404);
    const anaStream = await stream(ana);
    await upload(phone.token, [{ ago: 1, ...exact }]);
    expect(anaStream.events.some((entry) => entry.type === "person")).toBe(false);
    await from(owner.agent, "patch", apiPaths.v1.shares.one(share.id), { duration: "week" }).expect(
      404,
    );
    const again = await shareWith(ana.email, { duration: "endOfDay" });
    expect(again.id).not.toBe(share.id);
    expect(await peopleOf(ana)).toHaveLength(1);
    await stop(again.id);
  });
});

describe("sharing with an address without an account", () => {
  /** An invitation from the owner (the server's administrator), to `email` or open to anyone. */
  async function invitation(email?: string): Promise<string> {
    const made = await from(
      owner.agent,
      "post",
      apiPaths.admin.invites,
      email === undefined ? {} : { email },
    ).expect(201);
    return new URL(made.body.url).pathname.split("/").at(-1) ?? "";
  }

  async function signedUpWith(email: string, inviteToken: string): Promise<Person> {
    const agent = agentFor(t.app);
    await signUp(agent, new SoftwareAuthenticator(), email, { inviteToken });
    const session = await agent.get("/api/auth/session").expect(200);
    return { agent, cookie: "", email, id: session.body.user.id };
  }

  const listedShare = async (shareId: string) =>
    shareListResponseSchema
      .parse((await owner.agent.get(apiPaths.v1.shares.root).expect(200)).body)
      .shares.find((entry) => entry.id === shareId);

  const incomingOf = async (person: Person) =>
    incomingShareListResponseSchema.parse(
      (await person.agent.get(apiPaths.v1.shares.incoming).expect(200)).body,
    ).shares;

  it("waits for the owner to confirm whoever signs up with the address", async () => {
    const share = await shareWith("newcomer@allowed.test", { precision: "approximate" });
    expect(share).toMatchObject({
      status: "pending",
      recipient: { userId: null, displayName: null },
    });
    const ownerStream = await stream(owner);
    // The allow-list lets anyone in with this address: nothing proves it is the right person.
    const newcomer = await account("newcomer@allowed.test");
    expect(await ownerStream.waitFor("share")).toEqual({
      type: "share",
      shareId: share.id,
      userId: newcomer.id,
      change: "claimed",
    });
    expect(await listedShare(share.id)).toMatchObject({
      status: "joined",
      recipient: { email: "newcomer@allowed.test", userId: null, displayName: "newcomer" },
    });
    expect(await peopleOf(newcomer)).toEqual([]);
    expect(await incomingOf(newcomer)).toEqual([]);
    await newcomer.agent.get(apiPaths.v1.people.one(owner.id)).expect(404);
    const newcomerStream = await stream(newcomer);
    await upload(phone.token, [{ ago: 1, ...exact }]);
    expect(newcomerStream.events.map((event) => event.type)).toEqual(["hello"]);

    const confirmed = shareResponseSchema.parse(
      (await from(owner.agent, "post", apiPaths.v1.shares.confirm(share.id)).expect(200)).body,
    ).share;
    expect(confirmed).toMatchObject({
      status: "active",
      recipient: { userId: newcomer.id, displayName: "newcomer" },
    });
    expect(await newcomerStream.waitFor("share")).toEqual({
      type: "share",
      shareId: share.id,
      userId: owner.id,
      change: "created",
    });
    const [person] = await peopleOf(newcomer);
    expect(person?.userId).toBe(owner.id);
    expect(person?.devices[0]?.location?.precision).toBe("approximate");

    // Nothing left to confirm, nobody to confirm yet, or not one's own share.
    await from(owner.agent, "post", apiPaths.v1.shares.confirm(share.id)).expect(409);
    const nobody = await shareWith("nobody-yet@allowed.test");
    const early = await from(owner.agent, "post", apiPaths.v1.shares.confirm(nobody.id)).expect(
      409,
    );
    expect(errorOf(early.body).code).toBe("conflict");
    await from(eve.agent, "post", apiPaths.v1.shares.confirm(nobody.id)).expect(404);
    await from(owner.agent, "post", apiPaths.v1.shares.confirm("not-a-uuid")).expect(404);
    await stop(nobody.id);
    await stop(share.id);
  });

  it("starts at once when an invitation to that very address brought them", async () => {
    // Not on the allow-list: only the invitation lets this address in.
    const email = "invited@invited.test";
    const share = await shareWith(email);
    const joined = await signedUpWith(email, await invitation(email));
    expect(await listedShare(share.id)).toMatchObject({
      status: "active",
      recipient: { userId: joined.id },
    });
    expect((await peopleOf(joined)).map((person) => person.userId)).toEqual([owner.id]);
    await stop(share.id);
  });

  it("waits for confirmation after an open invitation", async () => {
    const email = "open@invited.test";
    const share = await shareWith(email);
    const joined = await signedUpWith(email, await invitation());
    expect(await listedShare(share.id)).toMatchObject({ status: "joined" });
    expect(await peopleOf(joined)).toEqual([]);
    await stop(share.id);
  });

  it("never binds a stopped or ended share, invitation or not", async () => {
    const stopped = await shareWith("late@invited.test");
    await stop(stopped.id);
    const ended = await shareWith("later@invited.test", { duration: "hour" });
    await t.ctx.db.execute(sql`UPDATE shares SET expires_at = now() WHERE id = ${ended.id}`);
    const late = await signedUpWith("late@invited.test", await invitation("late@invited.test"));
    const later = await signedUpWith("later@invited.test", await invitation("later@invited.test"));
    expect(await peopleOf(late)).toEqual([]);
    expect(await peopleOf(later)).toEqual([]);
    expect(await peopleOf(eve)).toEqual([]);
  });
});

describe("hiding a person", () => {
  it("holds for the person: their next share arrives hidden and without a notice", async () => {
    const first = await shareWith(ana.email);
    await from(ana.agent, "post", apiPaths.v1.shares.hide(first.id)).expect(200);
    await stop(first.id);
    const anaStream = await stream(ana);
    const again = await shareWith(ana.email);
    expect(again.status).toBe("hidden");
    await upload(phone.token, [{ ago: 1, ...exact }]);
    expect(anaStream.events.map((event) => event.type)).toEqual(["hello"]);
    expect(await peopleOf(ana)).toEqual([]);
    const [incoming] = incomingShareListResponseSchema.parse(
      (await ana.agent.get(apiPaths.v1.shares.incoming).expect(200)).body,
    ).shares;
    expect(incoming).toMatchObject({ id: again.id, owner: { userId: owner.id } });
    expect(incoming?.hiddenAt).not.toBeNull();

    // Shown again, the person is back, and the next share announces itself as usual.
    await from(ana.agent, "post", apiPaths.v1.shares.unhide(again.id)).expect(200);
    expect(await peopleOf(ana)).toHaveLength(1);
    await stop(again.id);
    const third = await shareWith(ana.email);
    expect(third.status).toBe("active");
    await expect
      .poll(
        () =>
          anaStream.events.some(
            (event) =>
              event.type === "share" && event.shareId === third.id && event.change === "created",
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    await stop(third.id);
  });
});

describe("a share and a sign-up at the same moment", () => {
  it("wait for each other, so a share never misses the account", async () => {
    const lock = new pg.Client({ connectionString: testDatabaseUrl });
    await lock.connect();
    try {
      // As if a sign-up were running right now.
      await lock.query("SELECT pg_advisory_lock($1)", [signupLockKey]);
      let done = false;
      const pending = shareWith("racing@allowed.test").then((share) => {
        done = true;
        return share;
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(done).toBe(false);
      await lock.query("SELECT pg_advisory_unlock($1)", [signupLockKey]);
      const share = await pending;
      expect(share.status).toBe("pending");
      await stop(share.id);
    } finally {
      await lock.end();
    }
  });
});

describe("what a shared device is doing", () => {
  const modeOf = (people: Awaited<ReturnType<typeof peopleOf>>) =>
    people[0]?.devices.find((device) => device.id === phone.id)?.activity?.mode;

  async function publicActivity(includeDetails: boolean) {
    const made = createShareLinkResponseSchema.parse(
      (
        await from(owner.agent, "post", apiPaths.v1.shareLinks.root, {
          precision: "area",
          deviceIds: [phone.id],
          includeDetails,
        }).expect(201)
      ).body,
    );
    const shown = publicShareResponseSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.publicShare)
          .set(shareSecretHeader, made.secret)
          .expect(200)
      ).body,
    );
    await from(owner.agent, "delete", apiPaths.v1.shareLinks.one(made.link.id)).expect(204);
    return shown.devices[0]?.activity ?? null;
  }

  it("is the owner's current transport mode, and only with details", async () => {
    const detailed = await shareWith(ana.email, { precision: "approximate" });
    const plain = await shareWith(eve.email, { precision: "approximate", includeDetails: false });
    // The quick toggle: from now on the phone travels by train.
    await from(owner.agent, "post", apiPaths.v1.devices.mode(phone.id), { mode: "train" }).expect(
      200,
    );
    const anaStream = await stream(ana);
    const eveStream = await stream(eve);
    const seen = { ana: anaStream.events.length, eve: eveStream.events.length };
    await upload(phone.token, [{ ago: 1, ...exact }]);
    expect((await anaStream.waitFor("person", 5_000, seen.ana)).device.activity?.mode).toBe(
      "train",
    );
    expect((await eveStream.waitFor("person", 5_000, seen.eve)).device.activity).toBeNull();
    expect(modeOf(await peopleOf(ana))).toBe("train");
    expect((await peopleOf(eve))[0]?.devices[0]?.activity).toBeNull();
    expect((await publicActivity(true))?.mode).toBe("train");
    expect(await publicActivity(false)).toBeNull();

    // The toggle ended: with no recent stop or move, nothing is known.
    await from(owner.agent, "post", apiPaths.v1.devices.mode(phone.id), { mode: null }).expect(200);
    expect(modeOf(await peopleOf(ana))).toBeNull();
    await stop(detailed.id);
    await stop(plain.id);
  });

  it("is what location processing tells the owner, for many devices in one query", async () => {
    const ids = await Promise.all(
      [
        "nothing",
        "bus",
        "corrected",
        "stop",
        "old",
        "toggle",
        "toggle ended",
        "toggle through a short stop",
        "toggle ended by a bike",
        "toggle over a misread ride",
      ].map(async (name) => (await createDevice(owner.agent, { name: `Mode ${name}` })).device.id),
    );
    const [
      nothing = "",
      bus = "",
      corrected = "",
      standing = "",
      old = "",
      toggled = "",
      ended = "",
      through = "",
      cycled = "",
      misread = "",
    ] = ids;
    const segment = (
      deviceId: string,
      kind: "stop" | "move",
      minutesAgo: [number, number],
      inferred: string | null,
      user: string | null = null,
    ) =>
      t.ctx.db.execute(sql`
        INSERT INTO segments (device_id, started_at, ended_at, kind, mode, mode_inferred, mode_user,
          distance_m, duration_s, point_count, start_lat, start_lon, end_lat, end_lon,
          centroid_lat, centroid_lon, features, version)
        VALUES (${deviceId}, now() - make_interval(mins => ${minutesAgo[0]}),
          now() - make_interval(mins => ${minutesAgo[1]}), ${kind},
          ${kind === "stop" ? null : (user ?? inferred)}, ${inferred}, ${user},
          800, 300, 12, 51, 3.7, 51.01, 3.71, 51.005, 3.705, '{}'::jsonb, 1)
      `);
    const toggle = (deviceId: string, minutesAgo: number, mode: string) =>
      t.ctx.db.execute(sql`
        INSERT INTO mode_overrides (device_id, kind, from_at, mode, source, created_by)
        VALUES (${deviceId}, 'toggle', now() - make_interval(mins => ${minutesAgo}), ${mode}, 'ui',
          ${owner.id})
      `);
    await segment(bus, "move", [20, 2], "bus");
    await segment(corrected, "move", [20, 2], "bus", "tram");
    await segment(standing, "move", [60, 30], "walking");
    await segment(standing, "stop", [30, 1], null);
    await segment(old, "move", [180, 120], "car");
    await segment(toggled, "move", [180, 120], "car");
    await toggle(toggled, 10, "cycling");
    await toggle(ended, 40, "train");
    await segment(ended, "move", [40, 20], "train");
    await segment(ended, "stop", [20, 5], null);
    // Five minutes on a platform, changing trains: the toggle runs on.
    await toggle(through, 40, "train");
    await segment(through, "move", [40, 20], "train");
    await segment(through, "stop", [20, 15], null);
    await segment(through, "move", [15, 2], "train");
    // Off the train, five minutes there, then home by bike: another kind of travel ends it.
    await toggle(cycled, 40, "train");
    await segment(cycled, "move", [40, 20], "train");
    await segment(cycled, "stop", [20, 15], null);
    await segment(cycled, "move", [15, 2], "cycling");
    // A bike set at the shed, the ride read as a car from its middle on: no stop since, still hers.
    await toggle(misread, 40, "cycling");
    await segment(misread, "move", [39, 30], "cycling");
    await segment(misread, "move", [30, 2], "car");

    const now = new Date();
    const options = { now, recentMs: t.ctx.config.liveWindowMinutes * 60_000 };
    const modes = await loadCurrentModes(t.ctx.db, ids, options);
    expect(Object.fromEntries(modes)).toEqual({
      [bus]: "bus",
      [corrected]: "tram",
      [standing]: "stationary",
      [toggled]: "cycling",
      [ended]: "stationary",
      [through]: "train",
      [cycled]: "cycling",
      [misread]: "cycling",
    });
    // A window after them sees where each toggle ended: at the bike ride, at none.
    const later = { from: new Date(now.getTime() + 60_000), to: new Date(now.getTime() + 120_000) };
    const [endedByRide] = await loadOverrides(t.ctx.db, cycled, later.from, later.to);
    const [runningOn] = await loadOverrides(t.ctx.db, through, later.from, later.to);
    const [ownRide] = await loadOverrides(t.ctx.db, misread, later.from, later.to);
    expect(ownRide?.endsBy).toBeNull();
    expect(Math.abs((endedByRide?.endsBy ?? 0) - (now.getTime() / 1000 - 15 * 60))).toBeLessThan(
      30,
    );
    expect(runningOn?.endsBy).toBeNull();
    expect(modes.has(nothing)).toBe(false);
    expect(modes.has(old)).toBe(false);
    const owners = await tokenPrincipal(t.ctx.db, owner.email, { scopes: ["locations:read"] });
    for (const id of ids) {
      const own = await loadDeviceMode(t.ctx.db, owners, id, options);
      expect(modes.get(id) ?? null, id).toBe(own.current?.mode ?? null);
    }
    for (const id of ids) {
      await from(owner.agent, "delete", apiPaths.devices.one(id)).expect(204);
    }
  });
});

describe("history", () => {
  let historyPhone = { id: "", token: "" };
  let shareId = "";

  beforeAll(async () => {
    const created = await createDevice(owner.agent, { name: "History phone" });
    historyPhone = { id: created.device.id, token: created.credentials.accessToken };
    const day = 86_400;
    await postOverland(
      t.app,
      historyPhone.token,
      uploadOf([
        { ago: 10 * day, lat: 50.1, lon: 4.1 },
        { ago: 3 * day, lat: 50.3, lon: 4.3 },
        { ago: 3 * day - 60, lat: 50.3005, lon: 4.3005 },
        { ago: 3600, lat: 50.5, lon: 4.5 },
      ]),
    ).expect(200);
    shareId = (await shareWith(ana.email, { deviceIds: [historyPhone.id], historyDays: 7 })).id;
  });

  afterAll(async () => {
    await stop(shareId);
  });

  const track = (query: Record<string, string>) =>
    ana.agent.get(apiPaths.v1.people.track(owner.id)).query(query);

  it("returns the shared days and never a point before them", async () => {
    const response = personTrackResponseSchema.parse(
      (
        await track({
          from: new Date(Date.now() - 30 * 86_400_000).toISOString(),
          to: new Date(Date.now() + 60_000).toISOString(),
        }).expect(200)
      ).body,
    );
    expect(Date.parse(response.from)).toBeGreaterThanOrEqual(Date.now() - 7 * 86_400_000 - 5_000);
    const [only] = response.tracks;
    expect(response.tracks).toHaveLength(1);
    expect(only?.deviceId).toBe(historyPhone.id);
    const lats = only?.points.map((point) => point[1]);
    expect(lats).toEqual([50.3, 50.3005, 50.5]);
    for (const point of only?.points ?? []) {
      expect(point[2] * 1000).toBeGreaterThanOrEqual(Date.parse(response.from));
    }
  });

  it("answers an empty track for a range before the history", async () => {
    const response = personTrackResponseSchema.parse(
      (
        await track({
          from: new Date(Date.now() - 20 * 86_400_000).toISOString(),
          to: new Date(Date.now() - 9 * 86_400_000).toISOString(),
        }).expect(200)
      ).body,
    );
    expect(response.tracks[0]?.points).toEqual([]);
  });

  it("checks the range and the devices", async () => {
    const now = Date.now();
    await track({
      from: new Date(now - 94 * 86_400_000).toISOString(),
      to: new Date(now).toISOString(),
    }).expect(400);
    await track({
      from: new Date(now).toISOString(),
      to: new Date(now - 1000).toISOString(),
    }).expect(400);
    await track({
      from: new Date(now - 86_400_000).toISOString(),
      to: new Date(now).toISOString(),
      deviceIds: phone.id,
    }).expect(404);
    await track({
      from: new Date(now - 86_400_000).toISOString(),
      to: new Date(now).toISOString(),
      deviceIds: anaPhone.id,
    }).expect(404);
  });

  it("shows the newest position of the window only", async () => {
    const [person] = await peopleOf(ana);
    expect(person?.devices[0]?.location).toMatchObject({ lat: 50.5, lon: 4.5 });
  });

  it("is not shared with live-only shares, whose newest position must be recent", async () => {
    await from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), { historyDays: null }).expect(
      200,
    );
    await track({
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date().toISOString(),
    }).expect(404);
    const stale = await createDevice(owner.agent, { name: "Quiet phone" });
    await postOverland(
      t.app,
      stale.credentials.accessToken,
      uploadOf([{ ago: 13 * 3600, lat: 50.9, lon: 4.9 }]),
    ).expect(200);
    await from(owner.agent, "patch", apiPaths.v1.shares.one(shareId), {
      deviceIds: [historyPhone.id, stale.device.id],
    }).expect(200);
    const [person] = await peopleOf(ana);
    const quiet = person?.devices.find((device) => device.id === stale.device.id);
    // Older than the live window (STALE_AFTER_HOURS, 12 h): no longer where its owner is.
    expect(quiet).toMatchObject({ location: null, battery: null, activity: null });
    expect(
      person?.devices.find((device) => device.id === historyPhone.id)?.location,
    ).not.toBeNull();
  });
});

describe("limits", () => {
  it("allows 50 current shares", async () => {
    const created: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      created.push((await shareWith(`many-${index}@allowed.test`)).id);
    }
    const refused = await from(owner.agent, "post", apiPaths.v1.shares.root, {
      email: "one-too-many@allowed.test",
      precision: "precise",
      duration: "hour",
    }).expect(409);
    expect(errorOf(refused.body).code).toBe("conflict");
    for (const id of created) await stop(id);
  });
});

describe("API tokens", () => {
  let shareId = "";

  beforeAll(async () => {
    shareId = (await shareWith(ana.email, { precision: "approximate" })).id;
  });

  afterAll(async () => {
    await stop(shareId);
  });

  const issue = async (
    email: string,
    scopes: Parameters<typeof tokenPrincipal>[2]["scopes"],
    deviceIds: string[] | null = null,
  ) => tokens.issue(await tokenPrincipal(t.ctx.db, email, { scopes, deviceIds }));

  it("need people:read for people and locations:read for distances", async () => {
    const people = await issue(ana.email, ["people:read"]);
    const listed = peopleResponseSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.v1.people.root)
          .set("Authorization", bearer(people))
          .expect(200)
      ).body,
    ).people;
    expect(listed[0]?.devices[0]?.distanceM).toBeNull();
    const both = await issue(ana.email, ["people:read", "locations:read"]);
    const measured = peopleResponseSchema.parse(
      (
        await request(t.app)
          .get(apiPaths.v1.people.root)
          .set("Authorization", bearer(both))
          .expect(200)
      ).body,
    ).people;
    expect(measured[0]?.devices[0]?.distanceM).toEqual(expect.any(Number));
    const noPeople = await issue(ana.email, ["devices:read", "locations:read", "shares:read"]);
    const refused = await request(t.app)
      .get(apiPaths.v1.people.root)
      .set("Authorization", bearer(noPeople))
      .expect(403);
    expect(errorOf(refused.body).code).toBe("insufficient_scope");
    expect(refused.headers["www-authenticate"]).toContain('scope="people:read"');
  });

  it("need shares:read to list and shares:write to change", async () => {
    const reader = await issue(owner.email, ["shares:read"]);
    await request(t.app)
      .get(apiPaths.v1.shares.root)
      .set("Authorization", bearer(reader))
      .expect(200);
    await request(t.app)
      .get(apiPaths.v1.shareLinks.root)
      .set("Authorization", bearer(reader))
      .expect(200);
    for (const pending of [
      request(t.app)
        .post(apiPaths.v1.shares.root)
        .send({ email: "x@allowed.test", precision: "precise", duration: "hour" }),
      request(t.app).delete(apiPaths.v1.shares.one(shareId)),
      request(t.app).post(apiPaths.v1.shares.hide(shareId)),
      request(t.app).post(apiPaths.v1.shareLinks.root).send({ precision: "area" }),
    ]) {
      const refused = await pending.set("Authorization", bearer(reader)).expect(403);
      expect(errorOf(refused.body).code).toBe("insufficient_scope");
    }
    const writer = await issue(owner.email, ["shares:write"]);
    await request(t.app)
      .get(apiPaths.v1.shares.root)
      .set("Authorization", bearer(writer))
      .expect(403);
    const full = await issue(owner.email, ["shares:write", "locations:read"]);
    const created = await request(t.app)
      .post(apiPaths.v1.shares.root)
      .set("Authorization", bearer(full))
      .send({ email: "token-share@allowed.test", precision: "area", duration: "hour" })
      .expect(201);
    // Stopping shows nothing: shares:write alone does it.
    await request(t.app)
      .delete(apiPaths.v1.shares.one(created.body.share.id))
      .set("Authorization", bearer(writer))
      .expect(204);
  });

  it("need locations:read too for anything that can show positions", async () => {
    // A share to an address it controls, or a precise link with history read back through the
    // public endpoint, would hand a shares:write token positions it may not read.
    const writer = await issue(owner.email, ["shares:write", "shares:read"]);
    for (const pending of [
      request(t.app)
        .post(apiPaths.v1.shares.root)
        .send({ email: "mine@allowed.test", precision: "precise", duration: "hour" }),
      request(t.app).patch(apiPaths.v1.shares.one(shareId)).send({ precision: "precise" }),
      request(t.app).post(apiPaths.v1.shares.confirm(shareId)),
      request(t.app)
        .post(apiPaths.v1.shareLinks.root)
        .send({ precision: "precise", historyDays: 7 }),
    ]) {
      const refused = await pending.set("Authorization", bearer(writer)).expect(403);
      expect(errorOf(refused.body)).toMatchObject({ code: "insufficient_scope" });
      expect(refused.headers["www-authenticate"]).toContain('scope="locations:read"');
    }
  });

  it("limited to devices share only those, and cannot widen other shares", async () => {
    const limited = await issue(
      owner.email,
      ["shares:write", "shares:read", "locations:read"],
      [phone.id],
    );
    const post = (body: Record<string, unknown>) =>
      request(t.app)
        .post(apiPaths.v1.shares.root)
        .set("Authorization", bearer(limited))
        .send({ email: "limited@allowed.test", precision: "precise", duration: "hour", ...body });
    const everything = await post({}).expect(400);
    expect(Object.keys(errorOf(everything.body).fields ?? {})).toEqual(["deviceIds"]);
    await post({ deviceIds: [watch] }).expect(404);
    const mine = await post({ deviceIds: [phone.id] }).expect(201);
    // The share with Ana shows every device: this token may not change it, only stop it.
    const widened = await request(t.app)
      .patch(apiPaths.v1.shares.one(shareId))
      .set("Authorization", bearer(limited))
      .send({ duration: "week" })
      .expect(403);
    expect(errorOf(widened.body).code).toBe("forbidden");
    await request(t.app)
      .patch(apiPaths.v1.shares.one(mine.body.share.id))
      .set("Authorization", bearer(limited))
      .send({ precision: "area" })
      .expect(200);
    await request(t.app)
      .delete(apiPaths.v1.shares.one(mine.body.share.id))
      .set("Authorization", bearer(limited))
      .expect(204);
  });

  it("limited to devices cannot narrow a share that also shows other devices", async () => {
    const both = await shareWith("both@allowed.test", { deviceIds: [phone.id, watch] });
    const limited = await issue(
      owner.email,
      ["shares:write", "shares:read", "locations:read"],
      [phone.id],
    );
    const narrowed = await request(t.app)
      .patch(apiPaths.v1.shares.one(both.id))
      .set("Authorization", bearer(limited))
      .send({ deviceIds: [phone.id] })
      .expect(403);
    expect(errorOf(narrowed.body).code).toBe("forbidden");
    await stop(both.id);
  });

  it("see their own devices through the access rules only with locations:read", async () => {
    const without = await tokenPrincipal(t.ctx.db, owner.email, { scopes: ["people:read"] });
    expect(
      (await resolveAccessibleDevices(t.ctx, without)).filter((device) => device.shareId === null),
    ).toEqual([]);
    await expect(resolveAccessibleDevices(t.ctx, without, [phone.id])).rejects.toMatchObject({
      status: 404,
    });
    const reader = await tokenPrincipal(t.ctx.db, owner.email, {
      scopes: ["people:read", "locations:read"],
    });
    const own = (await resolveAccessibleDevices(t.ctx, reader)).filter(
      (device) => device.shareId === null,
    );
    expect(own.map((device) => device.deviceId)).toContain(phone.id);
    expect(own.every((device) => device.precision === "precise" && device.from === null)).toBe(
      true,
    );
  });
});

describe("deleting a device", () => {
  it("takes it out of shares that named it, never widening them, and tells the recipient", async () => {
    const spare = await createDevice(owner.agent, { name: "Spare phone" });
    const share = await shareWith(ana.email, { deviceIds: [spare.device.id] });
    const anaStream = await stream(ana);
    await from(owner.agent, "delete", apiPaths.devices.one(spare.device.id)).expect(204);
    const told = await anaStream.waitFor("share");
    expect(told).toMatchObject({ shareId: share.id, change: "updated" });
    const [listed] = shareListResponseSchema.parse(
      (await owner.agent.get(apiPaths.v1.shares.root).expect(200)).body,
    ).shares;
    expect(listed?.deviceIds).toEqual([]);
    const [person] = await peopleOf(ana);
    expect(person?.devices).toEqual([]);
    await stop(share.id);
  });
});

describe("deleting an account", () => {
  it("ends what it shared and what was shared with it", async () => {
    const leaving = await account("leaving@allowed.test");
    const theirs = await createDevice(leaving.agent, { name: "Leaving phone" });
    await postOverland(
      t.app,
      theirs.credentials.accessToken,
      uploadOf([{ ago: 10, ...anaAt }]),
    ).expect(200);
    await from(leaving.agent, "post", apiPaths.v1.shares.root, {
      email: ana.email,
      precision: "precise",
      duration: "indefinitely",
    }).expect(201);
    const toThem = await shareWith(leaving.email);
    expect((await peopleOf(ana)).map((person) => person.userId)).toContain(leaving.id);
    const anaStream = await stream(ana);
    await from(leaving.agent, "delete", apiPaths.me.root, { confirmEmail: leaving.email }).expect(
      204,
    );
    expect((await anaStream.waitFor("share")).change).toBe("revoked");
    expect((await peopleOf(ana)).map((person) => person.userId)).not.toContain(leaving.id);
    const listed = shareListResponseSchema.parse(
      (await owner.agent.get(apiPaths.v1.shares.root).expect(200)).body,
    ).shares;
    expect(listed.map((entry) => entry.id)).not.toContain(toThem.id);
  });
});
