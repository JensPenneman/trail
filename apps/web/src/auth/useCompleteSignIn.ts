import { useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@trail/contracts/user";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { queryKeys } from "../api/queryKeys";
import { sessionEndedOnPurpose } from "../queries/sessionEndedOnPurpose";

const publicQueryRoots = new Set<unknown>([queryKeys.config[0], "link-info"]);

/**
 * After a successful ceremony: drop anything cached for a previous session
 * (another person may have used this browser), store the new session and go
 * on to where the person was headed.
 */
export function useCompleteSignIn(next: string): (user: SessionUser) => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(
    (user: SessionUser) => {
      queryClient.removeQueries({ predicate: (query) => !publicQueryRoots.has(query.queryKey[0]) });
      // a new session: when it ends by itself, the way back to the page is offered again
      sessionEndedOnPurpose.unmark(queryClient);
      queryClient.setQueryData(queryKeys.session, user);
      void navigate(next, { replace: true });
    },
    [queryClient, navigate, next],
  );
}
