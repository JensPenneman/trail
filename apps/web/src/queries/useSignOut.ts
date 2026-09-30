import { useMutation } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { useLeaveForSignIn } from "./useLeaveForSignIn";

/** Ends this browser's session and goes to the sign-in page. */
export function useSignOut() {
  const leave = useLeaveForSignIn();
  return useMutation({
    mutationKey: queryKeys.endSession,
    mutationFn: () => apiFetch(apiPaths.auth.logout, acknowledgementSchema, { method: "POST" }),
    onSuccess: leave,
  });
}
