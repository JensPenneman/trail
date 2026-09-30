import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentFor, signUp } from "../support/authFlows";
import { createDevice } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";

/* The access log keeps method and URL of every request: secrets in either must not reach it. */
let t: TestContext;
const lines: string[] = [];

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext({ logDestination: { write: (line: string) => lines.push(line) } });
});

afterAll(async () => {
  await t.close();
});

describe("the access log", () => {
  it("never contains a device token, however the query spells its name", async () => {
    const owner = agentFor(t.app);
    await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
    const { credentials } = await createDevice(owner, { name: "iPhone" });
    const token = credentials.accessToken;
    // `%74oken` is decoded to `token` by the query parser: the request authenticates.
    await request(t.app).get(`/api/overland?%74oken=${token}`).expect(200);
    await request(t.app).get(`/api/overland?access_token=${token}`).expect(200);
    await new Promise((resolve) => setImmediate(resolve));
    const logged = lines.filter((line) => line.includes("/api/overland"));
    expect(logged).toHaveLength(2);
    expect(logged.join("\n")).not.toContain(token.slice(4));
  });

  it("never contains the one-time token of a passkey link or invite", async () => {
    const secret = "5JqNf3kP0xYt7RmW2vLc9aBdE4gHs6uK1oZp8iQwXyU";
    await request(t.app).get(`/api/auth/link/${secret}`).expect(404);
    await request(t.app).post(`/api/auth/LINK/${secret}/start`).expect(403);
    await request(t.app).get(`/link/${secret}`);
    await request(t.app).get(`/invite/${secret}`);
    await new Promise((resolve) => setImmediate(resolve));
    const logged = lines.filter((line) => /link|invite|LINK/.test(line));
    expect(logged.length).toBeGreaterThanOrEqual(4);
    expect(logged.join("\n")).not.toContain(secret);
  });
});
