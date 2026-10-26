import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  apiTokenWithSecretResponseSchema,
  type CreateApiTokenRequest,
} from "@trail/contracts/apiToken";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The secret is only ever part of this answer: the caller shows it once. */
export function useCreateApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: queryKeys.createApiToken,
    mutationFn: (body: CreateApiTokenRequest) =>
      apiFetch(apiPaths.me.tokens, apiTokenWithSecretResponseSchema, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens }),
  });
}
