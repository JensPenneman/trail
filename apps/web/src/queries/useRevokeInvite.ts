import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      apiFetch(apiPaths.admin.invite(inviteId), acknowledgementSchema, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invites }),
  });
}
