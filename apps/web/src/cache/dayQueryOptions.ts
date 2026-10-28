import type { QueryClient } from "@tanstack/react-query";
import { browserCacheOf } from "./attachBrowserCache";
import { settledStaleTime } from "./settledDay";

/** A past period's answer is on disk too: memory need not keep it long. */
const storedGcMs = 2 * 60_000;

/**
 * What a query of a range of instants (tracks, levels, timeline, visits,
 * trips) takes from the copy: a past day whose stamps the digest still has is
 * never stale, and with a copy on disk a past period's answer leaves memory
 * after two minutes rather than five (a page that browses forty days of
 * History holds forty entries on disk and a handful in memory).
 */
export function dayQueryOptions(
  client: QueryClient,
  resource: string,
  params: { to: string } | null,
) {
  const past = params !== null && Date.parse(params.to) <= Date.now();
  return {
    staleTime: settledStaleTime(client, resource),
    ...(past && browserCacheOf(client) !== null ? { gcTime: storedGcMs } : {}),
  };
}
