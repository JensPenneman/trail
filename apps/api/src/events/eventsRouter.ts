import { randomInt } from "node:crypto";
import { apiPaths } from "@trail/contracts/apiPaths";
import { eventsQuerySchema } from "@trail/contracts/events";
import express, { type Request, type Router } from "express";
import type { AppContext } from "../appContext";
import { requireSession } from "../auth/requestAuth";
import { HttpError } from "../http/httpError";
import { processingVersions } from "../processing/processingVersion";
import { formatServerEvent } from "./formatServerEvent";

const maxStreamsPerUser = 10;
/**
 * Every open stream of the process. Past it a new one is told to come back
 * at a random moment 10–30 s later, so a crowd that reconnects at once (a
 * restart) spreads out instead of piling up.
 */
const maxStreams = 5_000;
/** A client that stopped reading is cut off instead of buffering events forever. */
const maxBufferedBytes = 1_000_000;

/**
 * Where a stream that comes back resumes: the browser's own reconnect sends
 * the id it saw last as `Last-Event-ID`, which is newer than an `after` the
 * page put in the URL when it opened the stream; a page that opens a new one
 * itself can only use `?after=`. Undefined for a fresh stream; an id that
 * fails the contract stands for one the server does not know (a resync,
 * never a 400).
 */
function resumeFrom(req: Request): string | undefined {
  const header = req.get("last-event-id");
  const given = header !== undefined && header !== "" ? header : req.query["after"];
  if (given === undefined) return undefined;
  const parsed = eventsQuerySchema.safeParse({ after: given });
  return parsed.success ? parsed.data.after : "";
}

/**
 * `GET /api/events` — the user's live events as Server-Sent Events
 * (docs/architecture.md §9). Every event has an id; a stream that comes back
 * with the last one it saw gets what it missed, or `resync` when that is
 * gone. The bus pings every stream and re-checks their sessions together, so
 * a revoked or expired session stops receiving data.
 */
export function eventsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.events, (req, res) => {
    const { user, sessionId } = requireSession(req);
    if (ctx.bus.streamCount() >= maxStreams) {
      res.setHeader("Retry-After", String(randomInt(10, 31)));
      throw new HttpError(
        503,
        "unavailable",
        "Too many live connections are open on this server. Retry in a moment.",
      );
    }
    if (ctx.bus.connectionCount(user.id) >= maxStreamsPerUser) {
      throw new HttpError(
        429,
        "rate_limited",
        "Too many live connections are open. Close a tab and retry.",
      );
    }
    const after = resumeFrom(req);
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    req.socket.setNoDelay(true);

    let closed = false;
    let unsubscribe = (): void => {};
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      res.end();
    };
    const write = (chunk: string) => {
      if (closed) return;
      if (res.writableLength > maxBufferedBytes) {
        close();
        return;
      }
      res.write(chunk);
    };

    const subscription = ctx.bus.subscribe(
      user.id,
      {
        sessionId,
        send: (_event, message) => write(message),
        ping: () => write(": ping\n\n"),
        close,
      },
      after,
    );
    unsubscribe = subscription.unsubscribe;
    res.on("close", close);
    // Per stream, so the browsers' own reconnects after a restart do not come back together.
    write(`retry: ${randomInt(3_000, 8_001)}\n\n`);
    write(
      formatServerEvent(
        { type: "hello", serverTime: new Date().toISOString(), versions: processingVersions },
        subscription.position,
      ),
    );
    if (subscription.missed === null) {
      write(formatServerEvent({ type: "resync" }, subscription.position));
    } else {
      for (const message of subscription.missed) write(message);
    }
  });

  return router;
}
