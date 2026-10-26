import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type CreateShareRequest, shareResponseSchema } from "@trail/contracts/share";
import { apiFetch } from "../api/apiFetch";
import { invalidateSharing } from "./invalidateSharing";

/** Starts sharing the signed-in person's location with an address. */
export function useCreateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShareRequest) =>
      apiFetch(apiPaths.v1.shares.root, shareResponseSchema, { body }),
    onSuccess: () => invalidateSharing(queryClient),
  });
}
