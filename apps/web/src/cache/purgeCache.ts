import type { QueryClient } from "@tanstack/react-query";
import { browserCacheOf } from "./attachBrowserCache";
import type { PurgeReason } from "./browserCache";

/** A browser whose IndexedDB hangs must not keep anyone from signing out. */
const purgeWaitMs = 2000;

/**
 * Empties the copy on disk and tells the other tabs (docs/architecture.md
 * §14): the paths that end whose data this browser may show — signing out,
 * deleting the account, a lost session, another account, the toggle off.
 * Nothing is written from the moment it is called; it resolves once the
 * store is empty, or after two seconds at most.
 */
export function purgeCache(client: QueryClient, reason: PurgeReason): Promise<void> {
  const purged = browserCacheOf(client)?.purge(reason);
  if (purged === undefined) return Promise.resolve();
  return Promise.race([
    purged,
    new Promise<void>((resolve) => {
      setTimeout(resolve, purgeWaitMs);
    }),
  ]);
}
