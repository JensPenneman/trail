import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Revokes the token at once; it stays listed as revoked for a while. */
export function useRevokeApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiFetch(apiPaths.me.token(tokenId), acknowledgementSchema, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens }),
  });
}
