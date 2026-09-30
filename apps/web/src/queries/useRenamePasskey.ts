import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

export function useRenamePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { passkeyId: string; name: string }) =>
      apiFetch(apiPaths.me.passkey(input.passkeyId), acknowledgementSchema, {
        method: "PATCH",
        body: { name: input.name },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.passkeys }),
  });
}
