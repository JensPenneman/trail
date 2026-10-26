import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type CreateShareLinkRequest,
  createShareLinkResponseSchema,
} from "@trail/contracts/shareLink";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Makes a public link; its address (with the secret) is only ever part of this answer. */
export function useCreateShareLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShareLinkRequest) =>
      apiFetch(apiPaths.v1.shareLinks.root, createShareLinkResponseSchema, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shareLinks }),
  });
}
