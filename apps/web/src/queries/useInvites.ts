import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { inviteListResponseSchema } from "@trail/contracts/invite";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Admins only. */
export function useInvites(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.invites,
    queryFn: ({ signal }) => apiFetch(apiPaths.admin.invites, inviteListResponseSchema, { signal }),
    select: (response) => response.invites,
    enabled,
  });
}
