import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiFetch } from "../api/apiFetch";
import { noContentSchema } from "../api/noContentSchema";
import { invalidateSharing } from "./invalidateSharing";

/** Stops one of the signed-in person's shares at once. */
export function useStopShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) =>
      apiFetch(apiPaths.v1.shares.one(shareId), noContentSchema, { method: "DELETE" }),
    onSuccess: () => invalidateSharing(queryClient),
  });
}
