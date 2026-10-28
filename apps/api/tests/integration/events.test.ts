import type { Server } from "node:http";
import { apiPaths } from "@trail/contracts/apiPaths";
import { daysResponseSchema } from "@trail/contracts/stats";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EventSubscriber } from "../../src/events/eventBus";
import { processingVersions } from "../../src/processing/processingVersion";
import { agentFor, signInWithCookie, signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { from, uploadOf } from "../support/sharingFlows";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { SseClient } from "../support/sseClient";
import { watchStatements } from "../support/statementCounter";
import { createTestContext, type TestContext } from "../support/testContext";
import { testOrigin } from "../support/testEnvironment";

let t: TestContext;
let server: Server;
const clients: SseClient[] = [];

const member = (email: string) => signUpWithCookie(t.app, email);

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
  server = t.app;
});

afterAll(async () => {
  for (const client of clients) client.close();
  await t.close();
});

describe("live events (SSE)", () => {
  it("delivers an upload to its owner's streams only", async () => {
    const owner = await member("first@example.com");
    const other = await member("other@allowed.test");
    const device = await createDevice(owner.agent, { name: "iPhone" });

    const ownerStream = await SseClient.connect(server, owner.cookie);
    const otherStream = await SseClient.connect(server, other.cookie);
    clients.push(ownerStream, otherStream);
    expect((await ownerStream.waitFor("hello")).serverTime).toMatch(/Z$/);
    await otherStream.waitFor("hello");

    await postOverland(t.app, device.credentials.accessToken, overlandFixture()).expect(200);
    const ingest = await ownerStream.waitFor("ingest");
    expect(ingest).toMatchObject({
      deviceId: device.device.id,
      inserted: 30,
      duplicates: 0,
      rejected: 0,
    });
    expect(ingest.points).toHaveLength(30);
    expect(ingest.points[0]?.slice(0, 2)).toEqual([3.7108, 51.0357334]);
    const update = await ownerStream.waitFor("device");
    expect(update.device.counts.total).toBe(30);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(otherStream.events.map((event) => event.type)).toEqual(["hello"]);
  });

  it("allows at most ten streams per user", async () => {
    const user = await member("busy@allowed.test");
    for (let index = 0; index < 10; index += 1) {
      const stream = await SseClient.connect(server, user.cookie);
      clients.push(stream);
      await stream.waitFor("hello");
    }
    await expect(SseClient.connect(server, user.cookie)).rejects.toThrow("SSE answered 429");
  });

  it("requires a session", async () => {
    await agentFor(t.app).get("/api/events").expect(401);
  });

  it("tells the stream that its session ended, then ends it, on logout", async () => {
    const user = await member("third@allowed.test");
    const stream = await SseClient.connect(server, user.cookie);
    clients.push(stream);
    await stream.waitFor("hello");
    await user.agent.post("/api/auth/logout").set("Origin", testOrigin).expect(204);
    // Without the reason the page would guess: check the session (a 401) and reconnect.
    await stream.waitFor("session-ended");
    await stream.ended();
    // A new stream is refused: the cookie no longer maps to a session.
    await expect(SseClient.connect(server, user.cookie)).rejects.toThrow("SSE answered 401");
  });

  it("tells the streams of a session revoked from another browser", async () => {
    const authenticator = new SoftwareAuthenticator();
    const first = await signUpWithCookie(t.app, "fourth@allowed.test", authenticator);
    const second = await signInWithCookie(t.app, authenticator, "fourth@allowed.test");
    const revoked = await SseClient.connect(server, second.cookie);
    const kept = await SseClient.connect(server, first.cookie);
    clients.push(revoked, kept);
    await revoked.waitFor("hello");
    await kept.waitFor("hello");
    await first.agent.post("/api/me/sessions/revoke-others").set("Origin", testOrigin).expect(200);
    await revoked.waitFor("session-ended");
    await revoked.ended();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(kept.events.map((event) => event.type)).toEqual(["hello"]);
  });

  it("tells every stream of an account that is deleted", async () => {
    const user = await member("fifth@allowed.test");
    const stream = await SseClient.connect(server, user.cookie);
    clients.push(stream);
    await stream.waitFor("hello");
    await user.agent
      .delete("/api/me")
      .set("Origin", testOrigin)
      .send({ confirmEmail: "fifth@allowed.test" })
      .expect(204);
    await stream.waitFor("session-ended");
    await stream.ended();
  });
});

/** A stand-in stream on the bus: what the cap and the session checks count, with nothing behind it. */
const fake = (sessionId: string): EventSubscriber => ({
  sessionId,
  send: () => {},
  ping: () => {},
  close: () => {},
});

const settle = async () => {
  await t.ctx.background.drain(5_000);
  await t.ctx.dailyStats.flush();
};

describe("event ids and resuming", () => {
  it("numbers every event, starts with versions and a jittered retry", async () => {
    const owner = await member("ids@allowed.test");
    const device = await createDevice(owner.agent, { name: "iPhone" });
    const stream = await SseClient.connect(server, owner.cookie);
    clients.push(stream);
    const hello = await stream.waitFor("hello");
    expect(hello.versions).toEqual(processingVersions);
    expect(stream.retryMs).toBeGreaterThanOrEqual(3_000);
    expect(stream.retryMs).toBeLessThanOrEqual(8_000);
    await postOverland(
      t.app,
      device.credentials.accessToken,
      uploadOf([{ ago: 5, lat: 51, lon: 3.7 }]),
    ).expect(200);
    await stream.waitFor("device");
    expect(stream.ids.every((id) => id !== undefined && /^[A-Za-z0-9_-]{8}:\d+$/.test(id))).toBe(
      true,
    );
    const seqs = stream.ids.map((id) => Number(id?.split(":")[1]));
    // The hello stands where the stream starts; every event after it is the next.
    expect(seqs).toEqual([0, 1, 2]);
  });

  it("replays what a stream missed when it comes back with the id it saw last", async () => {
    const owner = await member("resume@allowed.test");
    const device = await createDevice(owner.agent, { name: "iPhone" });
    const first = await SseClient.connect(server, owner.cookie);
    await first.waitFor("hello");
    const seen = first.lastId ?? "";
    first.close();
    // Away, while the phone uploads.
    await postOverland(
      t.app,
      device.credentials.accessToken,
      uploadOf([{ ago: 5, lat: 51, lon: 3.7 }]),
    ).expect(200);
    await t.ctx.background.drain(5_000);
    const back = await SseClient.connect(server, owner.cookie, { after: seen });
    clients.push(back);
    await back.waitFor("device");
    expect(back.events.map((event) => event.type)).toEqual(["hello", "ingest", "device"]);
    expect(back.ids[0]).toBe(seen);
    expect(back.events.some((event) => event.type === "resync")).toBe(false);
  });

  it("prefers the browser's Last-Event-ID to an older ?after=", async () => {
    const owner = await member("last-event-id@allowed.test");
    const device = await createDevice(owner.agent, { name: "iPhone" });
    const first = await SseClient.connect(server, owner.cookie);
    await first.waitFor("hello");
    const opened = first.lastId ?? "";
    await postOverland(
      t.app,
      device.credentials.accessToken,
      uploadOf([{ ago: 5, lat: 51, lon: 3.7 }]),
    ).expect(200);
    await first.waitFor("device");
    const latest = first.lastId ?? "";
    first.close();
    const back = await SseClient.connect(server, owner.cookie, {
      after: opened,
      lastEventId: latest,
    });
    clients.push(back);
    await back.waitFor("hello");
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Nothing happened after the newest id: nothing to replay, no resync.
    expect(back.events.map((event) => event.type)).toEqual(["hello"]);
    expect(back.ids[0]).toBe(latest);
  });

  it("answers resync to an id it does not hold: unknown, malformed, or from another process", async () => {
    const owner = await member("resync@allowed.test");
    for (const after of ["nonsense", "x".repeat(65)]) {
      const stream = await SseClient.connect(server, owner.cookie, { after });
      clients.push(stream);
      await stream.waitFor("resync");
      expect(stream.events.map((event) => event.type)).toEqual(["hello", "resync"]);
      // The id it stands at now is the server's own, never what came in.
      expect(stream.ids[1]).toBe(stream.ids[0]);
      expect(stream.ids[0]).not.toBe(after);
    }
    const first = await SseClient.connect(server, owner.cookie);
    clients.push(first);
    await first.waitFor("hello");
    // A new process: an empty ring, whatever the id.
    const restarted = await createTestContext();
    try {
      const back = await SseClient.connect(restarted.app, owner.cookie, {
        after: first.lastId ?? "",
      });
      await back.waitFor("resync");
      back.close();
    } finally {
      await restarted.close();
    }
  });

  it("tells the owner's streams of the days the statistics summed up, with their stamps", async () => {
    const owner = await member("days@allowed.test");
    const device = await createDevice(owner.agent, { name: "iPhone" });
    const stream = await SseClient.connect(server, owner.cookie);
    clients.push(stream);
    await stream.waitFor("hello");
    await postOverland(t.app, device.credentials.accessToken, overlandFixture()).expect(200);
    await settle();
    const days = await stream.waitFor("days");
    expect(days.deviceId).toBe(device.device.id);
    // The points' day, and the day before, which the fixture's trip started on.
    expect(days.dates).toEqual(["2026-09-28", "2026-09-29"]);
    const digest = daysResponseSchema.parse(
      (
        await owner.agent
          .get(apiPaths.statsDays)
          .query({ from: "2026-09-28", to: "2026-09-29" })
          .expect(200)
      ).body,
    );
    expect(days.days).toEqual(digest.days);
    expect(days.days[0]?.stamp.raw).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("tells of the days a visit-only upload touches, points or not", async () => {
    const owner = await member("visit-days@allowed.test");
    const device = await createDevice(owner.agent, { name: "iPhone" });
    const stream = await SseClient.connect(server, owner.cookie);
    clients.push(stream);
    await stream.waitFor("hello");
    // From 22:00 on 20 October to 07:00 on the 21st, Brussels time: a night away.
    await postOverland(t.app, device.credentials.accessToken, {
      locations: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [3.71, 51.03] },
          properties: {
            action: "visit",
            timestamp: "2026-10-21T05:00:30Z",
            arrival_date: "2026-10-20T20:00:00Z",
            departure_date: "2026-10-21T05:00:00Z",
            horizontal_accuracy: 20,
          },
        },
      ],
    }).expect(200);
    await settle();
    const days = await stream.waitFor("days");
    expect(days).toEqual({
      type: "days",
      deviceId: device.device.id,
      dates: ["2026-10-20", "2026-10-21"],
      // No points on either day, so no rows: the dates say what changed.
      days: [],
    });
  });

  it("sends a recipient who was away when a shared position came back to a resync", async () => {
    const sharer = await member("sharer@allowed.test");
    const viewer = await member("viewer@allowed.test");
    const phone = await createDevice(sharer.agent, { name: "iPhone" });
    await from(sharer.agent, "post", apiPaths.v1.shares.root, {
      email: "viewer@allowed.test",
      precision: "precise",
      duration: "indefinitely",
    }).expect(201);
    const first = await SseClient.connect(server, viewer.cookie);
    await first.waitFor("hello");
    const seen = first.lastId ?? "";
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // A position goes to an open page only: the one that comes back has to look again.
    await postOverland(
      t.app,
      phone.credentials.accessToken,
      uploadOf([{ ago: 5, lat: 51, lon: 3.7 }]),
    ).expect(200);
    await t.ctx.background.drain(5_000);
    const back = await SseClient.connect(server, viewer.cookie, { after: seen });
    clients.push(back);
    await back.waitFor("resync");
  });

  it("tells a stream to resync once a new time zone rebuilt every day", async () => {
    const owner = await member("zone@allowed.test");
    const stream = await SseClient.connect(server, owner.cookie);
    clients.push(stream);
    await stream.waitFor("hello");
    await from(owner.agent, "patch", apiPaths.me.root, { timezone: "America/New_York" }).expect(
      200,
    );
    await t.ctx.background.drain(5_000);
    await stream.waitFor("resync");
  });
});

describe("many streams", () => {
  it("checks every stream's session in one statement per tick", async () => {
    const owner = await member("tick@allowed.test");
    const second = await member("tick-two@allowed.test");
    const real = [
      await SseClient.connect(server, owner.cookie),
      await SseClient.connect(server, second.cookie),
    ];
    clients.push(...real);
    for (const stream of real) await stream.waitFor("hello");
    const fakes = Array.from({ length: 1_000 }, (_, index) =>
      t.ctx.bus.subscribe(
        `0199a0f2-0000-7000-8000-${String(index).padStart(12, "0")}`,
        fake(`fake-${index}`),
      ),
    );
    const watch = watchStatements(t.ctx.pool);
    try {
      await t.ctx.bus.tick();
      expect(watch.texts.filter((text) => /FROM sessions/.test(text))).toHaveLength(1);
      // A session revoked behind the server's back ends its stream at the next tick.
      const secondId = (
        await t.ctx.db.execute<{ id: string }>(sql`
          SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE u.email = 'tick-two@allowed.test'
        `)
      ).rows[0]?.id;
      await t.ctx.db.execute(sql`DELETE FROM sessions WHERE id = ${secondId ?? ""}`);
      watch.reset();
      await t.ctx.bus.tick();
      expect(watch.texts.filter((text) => /FROM sessions/.test(text))).toHaveLength(1);
      await real[1]?.waitFor("session-ended");
      await real[1]?.ended();
      expect(real[0]?.events.some((event) => event.type === "session-ended")).toBe(false);
    } finally {
      watch.stop();
      for (const subscription of fakes) subscription.unsubscribe();
    }
  });

  it("refuses a stream past the cap of the process with a 503 and a random Retry-After", async () => {
    const owner = await member("cap@allowed.test");
    const open = t.ctx.bus.streamCount();
    const fakes = Array.from({ length: 5_000 - open }, (_, index) =>
      t.ctx.bus.subscribe(
        `0199a0f2-1111-7000-8000-${String(index).padStart(12, "0")}`,
        fake(`cap-${index}`),
      ),
    );
    try {
      const refused = await agentFor(t.app)
        .get("/api/events")
        .set("Cookie", owner.cookie)
        .expect(503);
      expect(refused.body.error.code).toBe("unavailable");
      const wait = Number(refused.headers["retry-after"]);
      expect(wait).toBeGreaterThanOrEqual(10);
      expect(wait).toBeLessThanOrEqual(30);
    } finally {
      for (const subscription of fakes) subscription.unsubscribe();
    }
    const stream = await SseClient.connect(server, owner.cookie);
    clients.push(stream);
    await stream.waitFor("hello");
  });
});
