import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { linkInfoResponseSchema } from "@trail/contracts/auth";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** What a one-time invite or passkey link is for, before it is used. */
export function useLinkInfo(token: string) {
  return useQuery({
    queryKey: queryKeys.linkInfo(token),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.auth.link(token), linkInfoResponseSchema, { signal }),
    // The link is single use; re-checking it in the background would only race the ceremony.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}
