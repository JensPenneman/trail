import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { apiErrorSchema } from "@trail/contracts/errors";
import { liveHealthSchema } from "@trail/contracts/health";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startingListener } from "../../src/server/startingListener";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer(startingListener({ version: "1.2.3", commit: "abc1234" }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the server while it starts", () => {
  it("is live: the liveness probe says starting", async () => {
    const response = await fetch(`${base}/api/health/live`);
    expect(response.status).toBe(200);
    expect(liveHealthSchema.parse(await response.json())).toMatchObject({
      status: "starting",
      version: "1.2.3",
      commit: "abc1234",
    });
  });

  it("is not ready: the database check and everything else answer 503", async () => {
    for (const path of ["/api/health", "/api/health/processing", "/api/devices", "/"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(apiErrorSchema.parse(await response.json()).error.code).toBe("unavailable");
    }
  });
});
