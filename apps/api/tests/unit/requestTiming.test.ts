import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { RequestStats } from "../../src/requests/requestStats";
import { requestTiming } from "../../src/requests/requestTiming";
import { areaOf, followRoute } from "../../src/requests/routePattern";

/* requestTiming counts what the clients saw: answers, those a client left
 * without, and not the long-lived event streams. */
const servers: http.Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const eventually = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

async function serve(stats: RequestStats, reached: () => void) {
  const app = express();
  app.use(requestTiming(stats));
  app.get("/hang", (_req, res) => {
    res.write("partial");
    reached();
  });
  app.get("/events", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.write("data: 1\n\n");
    reached();
  });
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("the request timing", () => {
  it("records a request whose client left, as aborted, timed until the socket closed", async () => {
    const stats = new RequestStats();
    let reached = false;
    const port = await serve(stats, () => {
      reached = true;
    });
    const client = http.get({ port, host: "127.0.0.1", path: "/hang" });
    client.on("error", () => undefined);
    await eventually(() => reached);
    client.destroy();
    await eventually(() => stats.summary().length > 0);
    expect(stats.summary()).toMatchObject([
      { method: "GET", route: "/hang", last15m: { count: 1, aborted: 1 } },
    ]);
  });

  it("leaves an event stream out, however it ends", async () => {
    const stats = new RequestStats();
    let reached = false;
    const port = await serve(stats, () => {
      reached = true;
    });
    const client = http.get({ port, host: "127.0.0.1", path: "/events" });
    client.on("error", () => undefined);
    await eventually(() => reached);
    client.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stats.summary()).toEqual([]);
  });
});

describe("the route pattern", () => {
  it("puts a mount in any case in the series of its lower-case spelling", () => {
    const followed = (baseUrl: string) => {
      const req = { baseUrl } as unknown as express.Request;
      const pattern = followRoute(req);
      (req as { route?: unknown }).route = { path: "/" };
      return pattern();
    };
    expect(followed("/API/OVERLAND")).toBe("/api/overland");
    expect(followed("/api/overland")).toBe("/api/overland");
    expect(areaOf("/API/nope")).toBe("/api/*");
  });
});
