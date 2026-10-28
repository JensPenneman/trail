import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { purgeCache } from "../cache/purgeCache";
import { sessionEndedOnPurpose } from "./sessionEndedOnPurpose";
import { useLeaveForSignIn } from "./useLeaveForSignIn";

/** Ends this browser's session and goes to the sign-in page. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const leave = useLeaveForSignIn();
  return useMutation({
    mutationKey: queryKeys.endSession,
    // on purpose from the start: the event stream may report the end before the answer; and
    // the copy on disk goes before anything else, whatever the answer
    onMutate: async () => {
      sessionEndedOnPurpose.mark(queryClient);
      await purgeCache(queryClient, "sign-out");
    },
    mutationFn: () => apiFetch(apiPaths.auth.logout, acknowledgementSchema, { method: "POST" }),
    onError: () => sessionEndedOnPurpose.unmark(queryClient),
    onSuccess: leave,
  });
}
