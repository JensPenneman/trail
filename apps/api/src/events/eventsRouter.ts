import { apiPaths } from "@trail/contracts/apiPaths";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { HttpError } from "../http/httpError";
import { formatServerEvent } from "./formatServerEvent";
import { isSessionActive } from "./isSessionActive";

const maxStreamsPerUser = 10;
/** Proxies and tunnels drop idle streams after ~100 s. */
const pingIntervalMs = 20_000;
/** A client that stopped reading is cut off instead of buffering events forever. */
const maxBufferedBytes = 1_000_000;

/**
 * `GET /api/events` — the user's live events as Server-Sent Events
 * (docs/architecture.md §9). The session is re-checked with every ping, so a
 * revoked or expired session stops receiving data.
 */
export function eventsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.events, (req, res) => {
    const { user, sessionId } = requireAuth(req);
    if (ctx.bus.connectionCount(user.id) >= maxStreamsPerUser) {
      throw new HttpError(
        429,
        "rate_limited",
        "Too many live connections are open. Close a tab and retry.",
      );
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    req.socket.setNoDelay(true);

    let closed = false;
    let ping: NodeJS.Timeout | undefined;
    let unsubscribe = (): void => {};
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
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

    unsubscribe = ctx.bus.subscribe(user.id, {
      sessionId,
      send: (event) => write(formatServerEvent(event)),
      close,
    });
    res.on("close", close);
    write("retry: 5000\n\n");
    write(formatServerEvent({ type: "hello", serverTime: new Date().toISOString() }));

    ping = setInterval(() => {
      write(": ping\n\n");
      isSessionActive(ctx.db, sessionId)
        .then((active) => {
          if (active) return;
          write(formatServerEvent({ type: "session-ended" }));
          close();
        })
        .catch((error: unknown) => {
          ctx.logger.warn({ err: error }, "could not re-check the session of a live stream");
        });
    }, pingIntervalMs);
  });

  return router;
}
