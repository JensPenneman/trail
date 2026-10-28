import { afterEach, describe, expect, it } from "vitest";
import {
  type LivenessProbe,
  livenessPath,
  startLivenessServer,
} from "../../src/worker/livenessServer";

let probe: LivenessProbe | null = null;
let age: number | null = null;

/** Asks the probe, which watches a loop whose heartbeat is `age` old unless `starting`. */
async function ask(
  path = livenessPath,
  init?: RequestInit,
  options: { starting?: boolean } = {},
): Promise<Response> {
  if (probe === null) {
    probe = await startLivenessServer({ port: 0, host: "127.0.0.1" });
    if (options.starting !== true) probe.watch({ heartbeatAgeMs: () => age });
  }
  return fetch(`http://127.0.0.1:${probe.port}${path}`, init);
}

afterEach(async () => {
  await probe?.close();
  probe = null;
  age = null;
});

describe("the worker's liveness probe", () => {
  it("says starting, live, until it watches the loop (database and migrations)", async () => {
    const response = await ask(livenessPath, undefined, { starting: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "starting", heartbeatAgeS: null });
  });

  it("is live while the last heartbeat is under 90 s old", async () => {
    age = 12_400;
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", heartbeatAgeS: 12 });
    age = 89_999;
    expect((await ask()).status).toBe(200);
  });

  it("fails once the heartbeat is 90 s old, or when the loop wrote none", async () => {
    age = 90_000;
    const stale = await ask();
    expect(stale.status).toBe(503);
    expect(await stale.json()).toEqual({ status: "stalled", heartbeatAgeS: 90 });
    age = null;
    const none = await ask();
    expect(none.status).toBe(503);
    expect(await none.json()).toEqual({ status: "stalled", heartbeatAgeS: null });
  });

  it("answers HEAD without a body and a query string as the path", async () => {
    age = 1_000;
    const head = await ask(livenessPath, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await ask(`${livenessPath}?from=docker`)).status).toBe(200);
  });

  it("serves nothing else", async () => {
    age = 1_000;
    for (const path of ["/", "/metrics", "/health", "/api/health/live", `${livenessPath}/x`]) {
      const response = await ask(path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe("");
    }
    const post = await ask(livenessPath, { method: "POST", body: "{}" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("refuses a port that is already taken", async () => {
    await ask();
    const port = probe?.port ?? 0;
    await expect(startLivenessServer({ port, host: "127.0.0.1" })).rejects.toThrow(/EADDRINUSE/);
  });
});
