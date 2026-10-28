import type { QueryClient } from "@tanstack/react-query";
import type { BrowserCache } from "./browserCache";
import { cachePolicy } from "./cachePolicy";
import { createQueryPersister } from "./queryPersister";

const caches = new WeakMap<QueryClient, BrowserCache>();

/**
 * Gives a query client its copy on disk: every resource of the policy gets
 * the persister and `offlineFirst` — its query function runs once even
 * without a network, so the persister can restore the stored answer, and its
 * retries wait for the network to return (`cachedFetch` asks nothing while
 * offline). Any other query never meets the persister.
 */
export function attachBrowserCache(client: QueryClient, cache: BrowserCache): void {
  cache.attach(client);
  const persister = createQueryPersister(cache.storage);
  for (const resource of Object.keys(cachePolicy)) {
    client.setQueryDefaults([resource], {
      persister: persister.persisterFn,
      networkMode: "offlineFirst",
    });
  }
  caches.set(client, cache);
}

/** The copy of a query client, or null where it has none (public pages' tests, a client of its own). */
export function browserCacheOf(client: QueryClient): BrowserCache | null {
  return caches.get(client) ?? null;
}
