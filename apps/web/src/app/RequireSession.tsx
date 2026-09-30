import { useIsMutating } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router";
import { queryKeys } from "../api/queryKeys";
import { useSession } from "../queries/useSession";
import { AppLoading } from "./AppLoading";
import { loginPath } from "./loginPath";
import { ServerUnavailable } from "./ServerUnavailable";
import { SessionUserContext } from "./SessionUserContext";

/**
 * Signed-in routes render only with a session. Signed out (or a 401 anywhere,
 * which clears the cached session) → the login page, with a link back here —
 * unless the person is ending the session on purpose (the server may report
 * the end over the event stream before the sign-out request returns).
 */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();
  const endingSession = useIsMutating({ mutationKey: queryKeys.endSession }) > 0;
  if (session.data === undefined) {
    if (session.isError) {
      return (
        <ServerUnavailable
          error={session.error}
          onRetry={() => void session.refetch()}
          retrying={session.isFetching}
        />
      );
    }
    return <AppLoading />;
  }
  if (session.data === null) {
    return <Navigate to={endingSession ? "/login" : loginPath(location)} replace />;
  }
  return (
    <SessionUserContext value={session.data}>
      <Outlet />
    </SessionUserContext>
  );
}
