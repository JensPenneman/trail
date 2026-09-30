import { useMutation } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { DeleteAccountRequest } from "@trail/contracts/user";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { useLeaveForSignIn } from "./useLeaveForSignIn";

/** Deletes the account, its devices and every point; the session ends with it (→ sign-in page). */
export function useDeleteAccount() {
  const leave = useLeaveForSignIn();
  return useMutation({
    mutationKey: queryKeys.endSession,
    mutationFn: (body: DeleteAccountRequest) =>
      apiFetch(apiPaths.me.root, acknowledgementSchema, { method: "DELETE", body }),
    onSuccess: leave,
  });
}
