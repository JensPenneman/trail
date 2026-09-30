import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { sessionListResponseSchema } from "@trail/contracts/session";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Signed-in browser sessions of the current user. */
export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: ({ signal }) => apiFetch(apiPaths.me.sessions, sessionListResponseSchema, { signal }),
    select: (response) => response.sessions,
  });
}
