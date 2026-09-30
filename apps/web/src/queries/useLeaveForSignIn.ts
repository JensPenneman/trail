import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { queryKeys } from "../api/queryKeys";

/**
 * After signing out or deleting the account on purpose: the sign-in page, then
 * forget the session. In the other order the route guard would see a lost
 * session on the page still shown and add a link back to it (`?next=`), which
 * is right when a session ends by itself, not when the person ended it.
 */
export function useLeaveForSignIn(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    await navigate("/login", { replace: true });
    queryClient.setQueryData(queryKeys.session, null);
  }, [queryClient, navigate]);
}
