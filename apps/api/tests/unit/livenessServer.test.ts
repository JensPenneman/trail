import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeLivenessServer,
  livenessPath,
  startLivenessServer,
} from "../../src/worker/livenessServer";

let server: Server | null = null;
let age: number | null = null;

async function probe(path = livenessPath, init?: RequestInit): Promise<Response> {
  server ??= await startLivenessServer({
    port: 0,
    host: "127.0.0.1",
    loop: { heartbeatAgeMs: () => age },
  });
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

afterEach(async () => {
  if (server !== null) await closeLivenessServer(server);
  server = null;
  age = null;
});

describe("the worker's liveness probe", () => {
  it("is live while the last heartbeat is under 90 s old", async () => {
    age = 12_400;
    const response = await probe();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", heartbeatAgeS: 12 });
    age = 89_999;
    expect((await probe()).status).toBe(200);
  });

  it("fails once the heartbeat is 90 s old, and before the first", async () => {
    age = 90_000;
    const stale = await probe();
    expect(stale.status).toBe(503);
    expect(await stale.json()).toEqual({ status: "stalled", heartbeatAgeS: 90 });
    age = null;
    const none = await probe();
    expect(none.status).toBe(503);
    expect(await none.json()).toEqual({ status: "stalled", heartbeatAgeS: null });
  });

  it("answers HEAD without a body and a query string as the path", async () => {
    age = 1_000;
    const head = await probe(livenessPath, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await probe(`${livenessPath}?from=docker`)).status).toBe(200);
  });

  it("serves nothing else", async () => {
    age = 1_000;
    for (const path of ["/", "/metrics", "/health", "/api/health/live", `${livenessPath}/x`]) {
      const response = await probe(path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe("");
    }
    const post = await probe(livenessPath, { method: "POST", body: "{}" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("refuses a port that is already taken", async () => {
    await probe();
    if (server === null) throw new Error("the probe did not start");
    const { port } = server.address() as AddressInfo;
    await expect(
      startLivenessServer({ port, host: "127.0.0.1", loop: { heartbeatAgeMs: () => 0 } }),
    ).rejects.toThrow(/EADDRINUSE/);
  });
});
