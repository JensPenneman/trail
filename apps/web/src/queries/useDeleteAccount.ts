import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { DeleteAccountRequest } from "@trail/contracts/user";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Deletes the account, its devices and every point. The session ends with it. */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeleteAccountRequest) =>
      apiFetch(apiPaths.me.root, acknowledgementSchema, { method: "DELETE", body }),
    onSuccess: () => queryClient.setQueryData(queryKeys.session, null),
  });
}
