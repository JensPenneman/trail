import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { incomingShareResponseSchema } from "@trail/contracts/share";
import { apiFetch } from "../api/apiFetch";
import { invalidateSharing } from "./invalidateSharing";

/** Hides a person who shares with the signed-in person, or shows them again. */
export function useHidePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, hidden }: { shareId: string; hidden: boolean }) =>
      apiFetch(
        hidden ? apiPaths.v1.shares.hide(shareId) : apiPaths.v1.shares.unhide(shareId),
        incomingShareResponseSchema,
        { method: "POST" },
      ),
    onSuccess: () => invalidateSharing(queryClient),
  });
}
