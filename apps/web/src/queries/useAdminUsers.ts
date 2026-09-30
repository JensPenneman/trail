import { useQuery } from "@tanstack/react-query";
import { adminUserListResponseSchema } from "@trail/contracts/adminUser";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Admins only: every account on this server. */
export function useAdminUsers(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.admin.users, adminUserListResponseSchema, { signal }),
    select: (response) => response.users,
    enabled,
  });
}
