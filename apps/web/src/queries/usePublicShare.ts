import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { publicShareResponseSchema, shareSecretHeader } from "@trail/contracts/shareLink";
import { ApiError } from "../api/ApiError";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** A public page refreshes this often while it is visible. */
export const publicShareRefreshMs = 15_000;

/**
 * What a public link shows, refreshed every 15 s; an ended or unknown link is
 * not retried. The secret goes in a header, never into the request's URL.
 */
export function usePublicShare(secret: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.publicShare(secret),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.publicShare, publicShareResponseSchema, {
        headers: { [shareSecretHeader]: secret },
        signal,
      }),
    enabled,
    refetchInterval: (query) =>
      query.state.error instanceof ApiError && query.state.error.status === 404
        ? false
        : publicShareRefreshMs,
    refetchIntervalInBackground: false,
    retry: (failures, error) =>
      !(error instanceof ApiError && error.status === 404) && failures < 2,
  });
}
