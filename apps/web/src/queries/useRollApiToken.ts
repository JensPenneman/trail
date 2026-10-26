import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiTokenWithSecretResponseSchema } from "@trail/contracts/apiToken";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** A new secret for the token; the old one stops working immediately. */
export function useRollApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiFetch(apiPaths.me.rollToken(tokenId), apiTokenWithSecretResponseSchema, {
        method: "POST",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens }),
  });
}
