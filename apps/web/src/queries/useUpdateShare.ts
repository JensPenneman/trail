import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { shareResponseSchema, type UpdateShareRequest } from "@trail/contracts/share";
import { apiFetch } from "../api/apiFetch";
import { invalidateSharing } from "./invalidateSharing";

/** Changes what one of the signed-in person's shares shows, or for how long. */
export function useUpdateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, body }: { shareId: string; body: UpdateShareRequest }) =>
      apiFetch(apiPaths.v1.shares.one(shareId), shareResponseSchema, { method: "PATCH", body }),
    onSuccess: () => invalidateSharing(queryClient),
  });
}
