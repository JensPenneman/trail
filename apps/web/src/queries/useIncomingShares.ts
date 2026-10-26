import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { incomingShareListResponseSchema } from "@trail/contracts/share";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The shares others give the signed-in person, hidden ones included. */
export function useIncomingShares() {
  return useQuery({
    queryKey: queryKeys.incomingShares,
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.shares.incoming, incomingShareListResponseSchema, { signal }),
    select: (response) => response.shares,
  });
}
