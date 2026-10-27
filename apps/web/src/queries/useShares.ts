import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { shareListResponseSchema } from "@trail/contracts/share";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The people the signed-in person shares with (current shares); `enabled` false asks nothing. */
export function useShares({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.shares,
    queryFn: ({ signal }) => apiFetch(apiPaths.v1.shares.root, shareListResponseSchema, { signal }),
    select: (response) => response.shares,
    enabled,
  });
}
