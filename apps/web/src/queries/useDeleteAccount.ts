import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { DeleteAccountRequest } from "@trail/contracts/user";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { purgeCache } from "../cache/purgeCache";
import { sessionEndedOnPurpose } from "./sessionEndedOnPurpose";
import { useLeaveForSignIn } from "./useLeaveForSignIn";

/** Deletes the account, its devices and every point; the session ends with it (→ sign-in page). */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const leave = useLeaveForSignIn();
  return useMutation({
    mutationKey: queryKeys.endSession,
    // on purpose from the start: the event stream may report the end before the answer; and
    // the copy on disk goes before anything else, whatever the answer
    onMutate: async () => {
      sessionEndedOnPurpose.mark(queryClient);
      await purgeCache(queryClient, "account-deleted");
    },
    mutationFn: (body: DeleteAccountRequest) =>
      apiFetch(apiPaths.me.root, acknowledgementSchema, { method: "DELETE", body }),
    onError: () => sessionEndedOnPurpose.unmark(queryClient),
    onSuccess: leave,
  });
}
