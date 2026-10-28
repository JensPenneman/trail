import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { browserCacheOf } from "./attachBrowserCache";
import type { CacheState } from "./browserCache";
import type { CacheCounters } from "./cacheStats";

const noCopy: CacheState = { on: false, available: false, owner: null };
const noop = () => () => undefined;

/**
 * Whether this browser keeps a copy of the person's data (Settings ›
 * Preferences › On this device), whether it can, and the switch.
 */
export function useCacheEnabled(): CacheState & {
  setOn: (on: boolean) => Promise<void>;
  clear: () => Promise<void>;
} {
  const client = useQueryClient();
  const cache = browserCacheOf(client);
  const state = useSyncExternalStore(
    cache?.subscribe ?? noop,
    cache?.state ?? (() => noCopy),
    () => noCopy,
  );
  const setOn = useCallback((on: boolean) => cache?.setOn(on) ?? Promise.resolve(), [cache]);
  const clear = useCallback(() => cache?.clearCopy() ?? Promise.resolve(), [cache]);
  return { ...state, setOn, clear };
}

/** What the copy did during this page load (Settings › About). */
export function useCacheCounters(): CacheCounters | null {
  const client = useQueryClient();
  const stats = browserCacheOf(client)?.stats;
  return useSyncExternalStore(stats?.subscribe ?? noop, stats?.get ?? (() => null), () => null);
}
