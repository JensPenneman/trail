import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { ApiError } from "@trail/contracts/errors";
import type { LiveHealth } from "@trail/contracts/health";

/**
 * The server's answers while it waits for the database and runs the
 * migrations (docs/architecture.md §3): the liveness probe says `starting`
 * with 200, so a long migration cannot fail the container's health check (or
 * Launchway's `up --wait`); everything else, `/api/health` included, is 503
 * until the app serves.
 */
export function startingListener(build: { version: string; commit: string }): RequestListener {
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?", 1)[0];
    const live = path === apiPaths.healthLive && (req.method === "GET" || req.method === "HEAD");
    const body = JSON.stringify(
      live
        ? ({
            status: "starting",
            version: build.version,
            commit: build.commit,
            uptimeS: Math.round(process.uptime()),
          } satisfies LiveHealth)
        : ({
            error: { code: "unavailable", message: "Trail is starting. Try again in a moment." },
          } satisfies ApiError),
    );
    res.writeHead(live ? 200 : 503, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(body)),
      "Cache-Control": "no-store",
      ...(live ? {} : { "Retry-After": "5" }),
    });
    res.end(req.method === "HEAD" ? undefined : body);
  };
}
