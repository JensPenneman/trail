import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";

/**
 * After a share changed, here or on the other side: everything that shows
 * shares refetches. So does the access log, which records the change and
 * names people only while a share with them is in force — but nothing waits
 * for it: a share's page leaves once the shares have come, and a slower
 * answer of the log must not keep it there.
 */
export function invalidateSharing(queryClient: QueryClient): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: queryKeys.all.accessLog });
  return Promise.all(
    [queryKeys.people, queryKeys.shares, queryKeys.incomingShares].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  ).then(() => undefined);
}
