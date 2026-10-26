import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiFetch } from "../api/apiFetch";
import { noContentSchema } from "../api/noContentSchema";
import { queryKeys } from "../api/queryKeys";

/** Turns a public link off at once. */
export function useTurnOffShareLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      apiFetch(apiPaths.v1.shareLinks.one(linkId), noContentSchema, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shareLinks }),
  });
}
