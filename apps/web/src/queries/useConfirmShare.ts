import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { shareResponseSchema } from "@trail/contracts/share";
import { apiFetch } from "../api/apiFetch";
import { invalidateSharing } from "./invalidateSharing";

/** Confirms that whoever signed up with a waiting share's address is the person meant. */
export function useConfirmShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) =>
      apiFetch(apiPaths.v1.shares.confirm(shareId), shareResponseSchema, { method: "POST" }),
    onSuccess: () => invalidateSharing(queryClient),
  });
}
