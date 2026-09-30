import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The API refuses to delete the last passkey (`409 last_passkey`). */
export function useDeletePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (passkeyId: string) =>
      apiFetch(apiPaths.me.passkey(passkeyId), acknowledgementSchema, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.passkeys }),
  });
}
