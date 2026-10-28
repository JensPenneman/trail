import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/ApiError";
import { isSessionLost } from "../api/isSessionLost";
import { queryKeys } from "../api/queryKeys";
import { attachBrowserCache } from "../cache/attachBrowserCache";
import type { BrowserCache } from "../cache/browserCache";

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    // A client error or a response that breaks the contract will not fix itself.
    if (error.code === "invalid_response") return false;
    if (error.status >= 400 && error.status < 500 && error.status !== 408) return false;
  }
  return failureCount < 2;
}

/**
 * One cache per page load. A 401 from any request means the session is gone:
 * marking the cached session as signed-out lets the route guard send the
 * person to the login page with a `next` link back to where they were (and
 * empties the copy on disk). With `cache`, the signed-in person's own answers
 * are kept on disk as its policy says (docs/architecture.md §14). Changes are
 * never queued while offline: a mutation without a network fails at once.
 */
export function createQueryClient(cache: BrowserCache | null = null): QueryClient {
  const onError = (error: unknown): void => {
    if (isSessionLost(error)) client.setQueryData(queryKeys.session, null);
  };
  const client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000 },
      mutations: { retry: false, networkMode: "always" },
    },
  });
  if (cache !== null) attachBrowserCache(client, cache);
  return client;
}
