import express, { type Express } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { type RequestAuth, setRequestAuth, type UserRow } from "../../src/auth/requestAuth";
import type { LogLevel } from "../../src/config/config";
import { compress } from "../../src/http/compress";
import { createErrorHandler } from "../../src/http/errorHandler";
import { HttpError } from "../../src/http/httpError";
import { requestLogger } from "../../src/http/requestLogger";
import { createLogger } from "../../src/logging/createLogger";
import { daySpan } from "../../src/requests/daySpan";
import { RequestStats } from "../../src/requests/requestStats";
import { requestTiming } from "../../src/requests/requestTiming";
import { areaOf } from "../../src/requests/routePattern";

/*
 * The request log (docs/architecture.md §12): one line per request with its
 * route's pattern, status, duration, bytes and cache outcome — and nothing of
 * the path's ids, the query's values (a viewport is coordinates), the
 * account's id or its email; the redacted URL only at debug.
 */
const user: UserRow = {
  id: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60",
  email: "jens@example.com",
  displayName: "Jens",
  webauthnUserId: Buffer.alloc(32),
  isAdmin: false,
  timezone: "Europe/Brussels",
  preferences: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const session: RequestAuth = { kind: "session", user, sessionId: "s".repeat(64) };
const deviceId = "01a0f6c1-dcbf-7280-a465-b6dbb3f41c0c";
const viewport = "3.71234,51.01234,3.78765,51.06543";
const heatBody = { cells: Array.from({ length: 400 }, (_, index) => [index, index, 1]) };

let lines: Record<string, unknown>[] = [];

/** An app shaped like createApp's: timing, log, compression, a mounted router, routes, errors. */
function appWith(level: LogLevel = "info"): { app: Express; stats: RequestStats } {
  const logger = createLogger({
    level,
    destination: { write: (line: string) => lines.push(JSON.parse(line)) },
  });
  const stats = new RequestStats();
  const app = express();
  app.set("etag", false);
  app.use(requestTiming(stats));
  app.use(requestLogger(logger));
  app.use(compress());
  app.use((req, _res, next) => {
    if (req.get("x-signed-in") === "yes") setRequestAuth(req, session);
    next();
  });
  const v1 = express.Router();
  v1.get("/devices/:id", (_req, res) => {
    res.json({ name: "iPhone" });
  });
  v1.get("/devices/:id/fail", () => {
    throw new Error("broken");
  });
  v1.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "No such API route." } });
  });
  app.use("/api/v1", v1);
  const mcp = express.Router();
  mcp.post("/", (_req, res) => {
    res.status(202).end();
  });
  app.use("/mcp", mcp);
  app.get("/api/heatmap", (_req, res) => {
    res.json(heatBody);
  });
  app.get("/api/tracks", (req, res) => {
    if (req.get("if-none-match") === 'W/"same"') {
      res.status(304).end();
      return;
    }
    res.setHeader("ETag", 'W/"same"');
    res.json({ tracks: [] });
  });
  app.get("/api/forbidden", () => {
    throw new HttpError(403, "forbidden", "No.");
  });
  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not found.");
  });
  app.use(createErrorHandler(logger));
  return { app, stats };
}

/** The request log's line of the request with this id. */
const lineOf = (id: string): Record<string, unknown> => {
  const line = lines.find(
    (entry) =>
      (entry["req"] as { id?: unknown } | undefined)?.id === id && entry["res"] !== undefined,
  );
  if (line === undefined) throw new Error(`no line for ${id}`);
  return line;
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  lines = [];
});

describe("the request log line", () => {
  it("names the route's pattern, never the path's ids, and times the request", async () => {
    const { app, stats } = appWith();
    await request(app)
      .get(`/api/v1/devices/${deviceId}`)
      .set("X-Request-Id", "request-one")
      .expect(200);
    await settle();
    const line = lineOf("request-one");
    expect(line).toMatchObject({
      level: 30,
      route: "/api/v1/devices/:id",
      res: { statusCode: 200 },
      conditional: false,
      req: { id: "request-one", method: "GET" },
    });
    expect(line["ms"]).toBeTypeOf("number");
    expect(line["bytes"]).toBe(JSON.stringify({ name: "iPhone" }).length);
    expect(JSON.stringify(line)).not.toContain(deviceId);
    expect(line).not.toHaveProperty("url");
    expect(line).not.toHaveProperty("responseTime");
    expect(stats.summary().map(({ method, route }) => `${method} ${route}`)).toEqual([
      "GET /api/v1/devices/:id",
    ]);
  });

  it("keeps no query value: a viewport's coordinates and the times of a range stay out", async () => {
    const { app } = appWith();
    await request(app)
      .get(`/api/heatmap?bbox=${viewport}&zoom=13&deviceIds=${deviceId}`)
      .set("X-Request-Id", "request-heat")
      .set("Accept-Encoding", "gzip")
      .expect(200);
    await request(app)
      .get("/api/tracks?from=2026-10-16T22%3A00%3A00.000Z&to=2026-10-17T22%3A00%3A00.000Z")
      .set("X-Request-Id", "request-day")
      .expect(200);
    await settle();
    const heat = lineOf("request-heat");
    expect(heat).toMatchObject({ route: "/api/heatmap" });
    expect(heat).not.toHaveProperty("days");
    // Compressed on the way out: the bytes are those sent.
    expect(heat["bytes"]).toBeGreaterThan(0);
    expect(heat["bytes"]).toBeLessThan(JSON.stringify(heatBody).length / 2);
    expect(lineOf("request-day")).toMatchObject({ route: "/api/tracks", days: 1 });
    const logged = JSON.stringify(lines);
    for (const value of ["3.712", "51.012", "51.065", "bbox", deviceId, "2026-10-1", "zoom"]) {
      expect(logged).not.toContain(value);
    }
  });

  it("counts a week of tracks apart from a day's: the budget is for a day", async () => {
    const { app, stats } = appWith();
    await request(app)
      .get("/api/tracks?from=2026-10-16T22:00:00Z&to=2026-10-17T22:00:00Z")
      .expect(200);
    await request(app)
      .get("/api/tracks?from=2026-10-10T22:00:00Z&to=2026-10-17T22:00:00Z")
      .expect(200);
    await settle();
    expect(stats.summary()).toMatchObject([
      { route: "/api/tracks", longRanges: false, budgetMs: 400, last15m: { count: 1 } },
      { route: "/api/tracks", longRanges: true, budgetMs: null, last15m: { count: 1 } },
    ]);
  });

  it("tags the account opaquely: never its id or email", async () => {
    const { app } = appWith();
    await request(app)
      .get("/api/tracks")
      .set("x-signed-in", "yes")
      .set("X-Request-Id", "request-a")
      .expect(200);
    await request(app)
      .get("/api/tracks")
      .set("x-signed-in", "yes")
      .set("X-Request-Id", "request-b")
      .expect(200);
    await request(app).get("/api/tracks").set("X-Request-Id", "request-c").expect(200);
    await settle();
    const tag = lineOf("request-a")["account"];
    expect(tag).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(lineOf("request-b")["account"]).toBe(tag);
    expect(lineOf("request-c")).not.toHaveProperty("account");
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(user.id);
    expect(logged).not.toContain(user.email);
    // Another process (another key) tags the same account otherwise.
    const { app: restarted } = appWith();
    await request(restarted)
      .get("/api/tracks")
      .set("x-signed-in", "yes")
      .set("X-Request-Id", "request-d");
    await settle();
    expect(lineOf("request-d")["account"]).not.toBe(tag);
  });

  it("says whether the client asked conditionally and whether its copy was current", async () => {
    const { app, stats } = appWith();
    await request(app)
      .get("/api/tracks")
      .set("If-None-Match", 'W/"same"')
      .set("X-Request-Id", "request-hit")
      .expect(304);
    await request(app)
      .get("/api/tracks")
      .set("If-None-Match", 'W/"old"')
      .set("X-Request-Id", "request-miss")
      .expect(200);
    await settle();
    expect(lineOf("request-hit")).toMatchObject({ conditional: true, cache: "hit", bytes: 0 });
    expect(lineOf("request-miss")).toMatchObject({ conditional: true, cache: "miss" });
    expect(stats.summary()[0]?.last15m).toMatchObject({ count: 2, notModified: 1 });
  });

  it("keeps the pattern of a route whose error left its router, and logs it at error", async () => {
    const { app, stats } = appWith();
    await request(app)
      .get(`/api/v1/devices/${deviceId}/fail`)
      .set("X-Request-Id", "request-fail")
      .expect(500);
    await request(app).get("/api/forbidden").set("X-Request-Id", "request-403").expect(403);
    await settle();
    expect(lineOf("request-fail")).toMatchObject({
      level: 50,
      route: "/api/v1/devices/:id/fail",
      res: { statusCode: 500 },
    });
    expect(lineOf("request-403")).toMatchObject({ level: 40, route: "/api/forbidden" });
    const failing = stats.summary().find((route) => route.route === "/api/v1/devices/:id/fail");
    expect(failing?.last15m).toMatchObject({ count: 1, errors: 1 });
  });

  it("names a request outside every route by its area only, whatever its path holds", async () => {
    const { app } = appWith();
    const secret = "5JqNf3kP0xYt7RmW2vLc9aBdE4gHs6uK1oZp8iQwXyU";
    await request(app).get(`/api/v1/${secret}`).set("X-Request-Id", "request-v1").expect(404);
    await request(app).get(`/link/${secret}`).set("X-Request-Id", "request-link").expect(404);
    await request(app).post("/mcp").set("X-Request-Id", "request-mcp").expect(202);
    await settle();
    expect(lineOf("request-v1")).toMatchObject({ route: "/api/v1/*" });
    expect(lineOf("request-link")).toMatchObject({ route: "/*" });
    expect(lineOf("request-mcp")).toMatchObject({ route: "/mcp" });
    expect(JSON.stringify(lines)).not.toContain(secret);
  });

  it("logs the URL's parameter names at debug, never a value", async () => {
    const { app } = appWith("debug");
    await request(app)
      .get(`/api/heatmap?bbox=${viewport}&zoom=13`)
      .set("X-Request-Id", "request-debug")
      .expect(200);
    await settle();
    const line = lineOf("request-debug");
    expect(line).toMatchObject({ req: { url: "/api/heatmap?bbox&zoom" }, route: "/api/heatmap" });
    const logged = JSON.stringify(lines);
    for (const value of ["3.712", "51.012", "51.065", "13"]) {
      expect(logged).not.toContain(`=${value}`);
    }
  });
});

describe("the areas and day spans of the request log", () => {
  it("names areas by fixed prefixes only", () => {
    expect(areaOf("/api/v1/whatever/else")).toBe("/api/v1/*");
    expect(areaOf("/API/V1")).toBe("/api/v1/*");
    expect(areaOf("/api/nope")).toBe("/api/*");
    expect(areaOf("/assets/index-abc.js")).toBe("/assets/*");
    expect(areaOf("/settings/devices/0199a0f2")).toBe("/*");
    expect(areaOf("/")).toBe("/*");
  });

  it("counts the days of a range: local dates with both ends, instants by their hours", () => {
    expect(daySpan("/api/stats/days?from=2026-10-01&to=2026-10-31")).toBe(31);
    expect(daySpan("/api/stats/days?from=2026-10-28&to=2026-10-28")).toBe(1);
    // 25 hours: the day the clocks went back.
    expect(daySpan("/api/tracks?from=2026-10-24T22:00:00Z&to=2026-10-25T23:00:00Z")).toBe(1);
    expect(daySpan("/api/tracks?from=2026-10-27T23:00:00Z&to=2026-10-28T03:00:00Z")).toBe(1);
    expect(daySpan("/api/tracks?from=2026-10-21T22:00:00Z&to=2026-10-28T23:00:00Z")).toBe(7);
    expect(daySpan("/api/v1/insights/overview?to=2026-10-28")).toBeNull();
    expect(daySpan("/api/tracks?from=2026-10-28&to=2026-10-29T00:00:00Z")).toBeNull();
    expect(daySpan("/api/tracks?from=later&to=sooner")).toBeNull();
    expect(daySpan("/api/tracks?from=2026-10-28&to=2026-10-01")).toBeNull();
    expect(daySpan("/api/tracks")).toBeNull();
  });
});
