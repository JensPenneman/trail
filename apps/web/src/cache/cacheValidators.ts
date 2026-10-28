import { hashKey, type QueryClient } from "@tanstack/react-query";
import { normalizedQueryKey } from "./cacheKey";

/*
 * The ETag of each answer in memory, per query client: what a revalidation
 * sends as `If-None-Match`. It belongs to the answer on screen — set when an
 * answer arrives or is restored from the store — so a `304` hands back what
 * the page already shows. Kept apart from the store: a browser that keeps no
 * copy on disk still saves the server a body while the page is open.
 */
const byClient = new WeakMap<QueryClient, Map<string, string>>();

const keyOf = (queryKey: readonly unknown[]): string => hashKey(normalizedQueryKey(queryKey));

export const cacheValidators = {
  get(client: QueryClient, queryKey: readonly unknown[]): string | null {
    return byClient.get(client)?.get(keyOf(queryKey)) ?? null;
  },
  set(client: QueryClient, queryKey: readonly unknown[], etag: string | null): void {
    let validators = byClient.get(client);
    if (validators === undefined) {
      validators = new Map();
      byClient.set(client, validators);
    }
    if (etag === null) validators.delete(keyOf(queryKey));
    else validators.set(keyOf(queryKey), etag);
  },
  /** A purge: nothing on screen belongs to an answer the server may still confirm. */
  clear(client: QueryClient): void {
    byClient.delete(client);
  },
};
