import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { queryKeys } from "../api/queryKeys";

/**
 * After signing out or deleting the account on purpose: the sign-in page, then
 * forget the session. The page stays mounted until the sign-in page has
 * rendered (React Router renders it in a transition), so the route guard may
 * still see the session go; sessionEndedOnPurpose, marked when the request
 * started, keeps it from adding a link back to the page (`?next=`).
 */
export function useLeaveForSignIn(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    await navigate("/login", { replace: true });
    queryClient.setQueryData(queryKeys.session, null);
  }, [queryClient, navigate]);
}
