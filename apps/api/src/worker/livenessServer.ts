import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { heartbeatStaleS } from "./workerHeartbeats";

/** The worker's liveness probe, on PROCESSING_METRICS_PORT (docs/architecture.md §3). */
export const livenessPath = "/health/live";

/** What the probe asks of the worker loop. */
interface HeartbeatAge {
  /** Milliseconds since the loop last wrote its heartbeat; null before the first. */
  heartbeatAgeMs(): number | null;
}

/**
 * The worker process's own port: `GET /health/live` answers 200 while the
 * loop's last written heartbeat is under 90 s old and 503 once it is older, or
 * before the first — a loop that stopped beating fails its container's health
 * check, as the API sees it gone (`/api/health`). Nothing else is served, and
 * nothing routes to the port: Compose publishes it nowhere.
 */
export function startLivenessServer(input: {
  port: number;
  host: string;
  loop: HeartbeatAge;
}): Promise<Server> {
  const server = createServer((req, res) => {
    respond(req, res, input.loop);
  });
  // A probe asks a few bytes and goes: no connection is held open for long.
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/** Stops listening and drops the connections still open. */
export function closeLivenessServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  server.closeAllConnections();
  return closed;
}

function respond(req: IncomingMessage, res: ServerResponse, loop: HeartbeatAge): void {
  const path = (req.url ?? "").split("?", 1)[0];
  if (path !== livenessPath) {
    res.writeHead(404, { "Content-Length": "0" }).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Length": "0" }).end();
    return;
  }
  const ageMs = loop.heartbeatAgeMs();
  const live = ageMs !== null && ageMs < heartbeatStaleS * 1_000;
  const body = JSON.stringify({
    status: live ? "ok" : "stalled",
    heartbeatAgeS: ageMs === null ? null : Math.floor(ageMs / 1_000),
  });
  res.writeHead(live ? 200 : 503, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "Cache-Control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}
