import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type CreateInviteRequest, createInviteResponseSchema } from "@trail/contracts/invite";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Admins only. The invite URL (with its secret) is only ever part of this answer. */
export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInviteRequest) =>
      apiFetch(apiPaths.admin.invites, createInviteResponseSchema, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invites }),
  });
}
