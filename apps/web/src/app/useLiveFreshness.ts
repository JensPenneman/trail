import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { appStartedAt } from "./appStartedAt";

/** The answers that make a page live: one's devices and today's tracks, levels, timeline and mode. */
const liveResources = new Set<unknown>([
  "devices",
  "tracks",
  "level-tracks",
  "timeline",
  "device-mode",
]);

export interface LiveFreshness {
  /** Some of them are on screen; none on a page without them (Settings, Insights). */
  shown: boolean;
  /** When the oldest of them was fetched or confirmed, epoch ms. */
  asOf: number | null;
  /** One of them came from the copy on disk and has not been confirmed since. */
  fromCopy: boolean;
  /** One of them is being asked for again while on screen. */
  updating: boolean;
}

const none: LiveFreshness = { shown: false, asOf: null, fromCopy: false, updating: false };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function measure(client: QueryClient, now: number): LiveFreshness {
  let asOf = Number.POSITIVE_INFINITY;
  let fromCopy = false;
  let updating = false;
  let shown = false;
  for (const query of client.getQueryCache().getAll()) {
    if (!liveResources.has(query.queryKey[0]) || !query.isActive()) continue;
    if (query.state.data === undefined) continue;
    // A past day in History is not live data, however fresh.
    const params = query.queryKey[1];
    if (isRecord(params) && typeof params["to"] === "string" && Date.parse(params["to"]) <= now) {
      continue;
    }
    shown = true;
    asOf = Math.min(asOf, query.state.dataUpdatedAt);
    if (query.state.dataUpdatedAt < appStartedAt) fromCopy = true;
    if (query.state.fetchStatus === "fetching") updating = true;
  }
  return shown ? { shown, asOf, fromCopy, updating } : none;
}

const same = (a: LiveFreshness, b: LiveFreshness): boolean =>
  a.shown === b.shown &&
  a.asOf === b.asOf &&
  a.fromCopy === b.fromCopy &&
  a.updating === b.updating;

/** How fresh the live answers on screen are, kept current as the query cache changes. */
export function useLiveFreshness(): LiveFreshness {
  const client = useQueryClient();
  const last = useRef<LiveFreshness>(none);
  const subscribe = useCallback(
    (listener: () => void) => client.getQueryCache().subscribe(listener),
    [client],
  );
  const getSnapshot = useCallback(() => {
    const next = measure(client, Date.now());
    if (!same(next, last.current)) last.current = next;
    return last.current;
  }, [client]);
  return useSyncExternalStore(subscribe, getSnapshot, () => none);
}
