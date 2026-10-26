import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { DeleteAccountRequest } from "@trail/contracts/user";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { sessionEndedOnPurpose } from "./sessionEndedOnPurpose";
import { useLeaveForSignIn } from "./useLeaveForSignIn";

/** Deletes the account, its devices and every point; the session ends with it (→ sign-in page). */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const leave = useLeaveForSignIn();
  return useMutation({
    mutationKey: queryKeys.endSession,
    // on purpose from the start: the event stream may report the end before the answer
    onMutate: () => sessionEndedOnPurpose.mark(queryClient),
    mutationFn: (body: DeleteAccountRequest) =>
      apiFetch(apiPaths.me.root, acknowledgementSchema, { method: "DELETE", body }),
    onError: () => sessionEndedOnPurpose.unmark(queryClient),
    onSuccess: leave,
  });
}
