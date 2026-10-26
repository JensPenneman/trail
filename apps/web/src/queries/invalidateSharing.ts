import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";

/** After a share changed, here or on the other side: everything that shows shares refetches. */
export function invalidateSharing(queryClient: QueryClient): Promise<void> {
  return Promise.all(
    [queryKeys.people, queryKeys.shares, queryKeys.incomingShares].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  ).then(() => undefined);
}
