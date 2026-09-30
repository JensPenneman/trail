import { useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { ServerEventType } from "@trail/contracts/events";
import { useEffect } from "react";
import { queryKeys } from "../api/queryKeys";
import { applyServerEvent } from "./applyServerEvent";
import type { LiveStore } from "./createLiveStore";
import { parseServerEvent } from "./parseServerEvent";
import { resyncAfterGap } from "./resyncAfterGap";

const eventTypes = [
  "hello",
  "device",
  "device-removed",
  "ingest",
  "session-ended",
] as const satisfies readonly ServerEventType[];

/** Appended points are drawn at once; the server's distance and simplification follow this much later. */
const trackRefreshDelayMs = 20_000;
/** A tab hidden longer than this may hold a stream that a proxy silently dropped. */
const staleAfterHiddenMs = 30_000;
/** A reconnect within this time is not worth alarming anyone about. */
const reconnectGraceMs = 2500;
/** A stream that keeps dropping must not turn every reconnect into a full refetch. */
const minResyncIntervalMs = 15_000;

function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
  return base * (0.75 + Math.random() * 0.5);
}

/**
 * Keeps one `/api/events` stream open while signed in and folds its events
 * into the caches. Reconnects with jittered exponential backoff (the browser's
 * own retry gives up for good on an HTTP error), immediately when the tab
 * becomes visible or the network returns, and resynchronises after any gap —
 * events sent while disconnected are lost. When the server says the session
 * ended, the stream stays closed: a reconnect could only be refused.
 */
export function useServerEvents(store: LiveStore): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let resyncTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let openedBefore = false;
    let sessionEnded = false;
    let lastResync = 0;
    let hiddenSince: number | null = null;

    const resync = (): void => {
      clearTimeout(resyncTimer);
      const wait = lastResync + minResyncIntervalMs - Date.now();
      if (wait > 0) {
        resyncTimer = setTimeout(resync, wait);
        return;
      }
      lastResync = Date.now();
      resyncAfterGap(queryClient);
    };

    const onOpen = (): void => {
      failures = 0;
      clearTimeout(graceTimer);
      store.setConnection("open");
      if (openedBefore) resync();
      openedBefore = true;
    };

    const onMessage = (message: MessageEvent<unknown>): void => {
      const event = parseServerEvent(message.data);
      if (event === null) return;
      if (event.type === "session-ended") {
        sessionEnded = true;
        for (const timer of [retryTimer, graceTimer, resyncTimer]) clearTimeout(timer);
        close();
      }
      applyServerEvent(queryClient, store, event);
      if (event.type === "ingest") {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.all.tracks });
        }, trackRefreshDelayMs);
      }
    };

    const close = (): void => {
      if (source === null) return;
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.removeEventListener("message", onMessage);
      for (const type of eventTypes) source.removeEventListener(type, onMessage);
      source.close();
      source = null;
    };

    const connect = (): void => {
      clearTimeout(retryTimer);
      close();
      if (sessionEnded) return;
      if (!openedBefore) store.setConnection("connecting");
      source = new EventSource(apiPaths.events);
      source.addEventListener("open", onOpen);
      source.addEventListener("error", onError);
      source.addEventListener("message", onMessage);
      for (const type of eventTypes) source.addEventListener(type, onMessage);
    };

    function onError(): void {
      close();
      clearTimeout(graceTimer);
      graceTimer = setTimeout(() => store.setConnection("reconnecting"), reconnectGraceMs);
      // A stream that keeps failing may mean the session ended; the guard reacts to a 401.
      // Not while this browser is ending the session itself: the answer is known (and a 401).
      const endingSession = queryClient.isMutating({ mutationKey: queryKeys.endSession }) > 0;
      if (failures % 5 === 0 && !endingSession) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      }
      retryTimer = setTimeout(connect, backoffMs(failures));
      failures += 1;
    }

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
        return;
      }
      const hiddenLong = hiddenSince !== null && Date.now() - hiddenSince > staleAfterHiddenMs;
      hiddenSince = null;
      if (source === null || hiddenLong) {
        failures = 0;
        connect();
      }
    };

    const onOnline = (): void => {
      if (source === null) {
        failures = 0;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      for (const timer of [retryTimer, refreshTimer, graceTimer, resyncTimer]) clearTimeout(timer);
      close();
    };
  }, [queryClient, store]);
}
