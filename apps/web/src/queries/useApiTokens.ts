import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiTokenListResponseSchema } from "@trail/contracts/apiToken";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The account's API tokens, newest first, revoked and expired ones too until they are removed. */
export function useApiTokens() {
  return useQuery({
    queryKey: queryKeys.apiTokens,
    queryFn: ({ signal }) => apiFetch(apiPaths.me.tokens, apiTokenListResponseSchema, { signal }),
    select: (response) => response.tokens,
  });
}
