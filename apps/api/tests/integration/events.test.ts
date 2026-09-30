import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentFor, signUpWithCookie } from "../support/authFlows";
import { createDevice, postOverland } from "../support/deviceFlows";
import { overlandFixture } from "../support/overlandFixture";
import { resetDatabase } from "../support/resetDatabase";
import { SseClient } from "../support/sseClient";
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

  it("ends the stream when the session is revoked", async () => {
    const user = await member("third@allowed.test");
    const stream = await SseClient.connect(server, user.cookie);
    clients.push(stream);
    await stream.waitFor("hello");
    await user.agent.post("/api/auth/logout").set("Origin", testOrigin).expect(204);
    await stream.ended();
    // A new stream is refused: the cookie no longer maps to a session.
    await expect(SseClient.connect(server, user.cookie)).rejects.toThrow("SSE answered 401");
  });
});
