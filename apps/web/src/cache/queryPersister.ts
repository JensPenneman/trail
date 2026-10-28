import {
  type AsyncStorage,
  experimental_createQueryPersister,
  type PersistedQuery,
} from "@tanstack/query-persist-client-core";
import { policyOf } from "./cachePolicy";

/** The persister's storage keys are `trail-<queryHash>`. */
export const persisterPrefix = "trail";

/**
 * TanStack Query's per-query persister over the store (docs/architecture.md
 * §14): it wraps the `queryFn` of every query the policy lists, restores a
 * stored answer on the query's first fetch with the answer's own
 * `dataUpdatedAt` — so `staleTime` behaves as if it had just been fetched
 * then — resolves it at once and revalidates in the background when it is
 * stale, and hands every new answer to the storage. The storage
 * (`BrowserCache.storage`) decides the rest: whose it is, whether it may be
 * kept, its packing, its checks, the budgets. Entries never expire here; the
 * store's TTLs count from when an entry was last shown.
 */
export function createQueryPersister(storage: AsyncStorage<PersistedQuery>) {
  return experimental_createQueryPersister<PersistedQuery>({
    storage,
    prefix: persisterPrefix,
    maxAge: Number.POSITIVE_INFINITY,
    serialize: (persisted) => persisted,
    deserialize: (stored) => stored,
    refetchOnRestore: true,
    filters: { predicate: (query) => policyOf(query.queryKey) !== null },
  });
}
