import { useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router";
import { sessionEndedOnPurpose } from "../queries/sessionEndedOnPurpose";
import { useSession } from "../queries/useSession";
import { AppLoading } from "./AppLoading";
import { loginPath } from "./loginPath";
import { ServerUnavailable } from "./ServerUnavailable";
import { SessionUserContext } from "./SessionUserContext";

/**
 * Signed-in routes render only with a session. Signed out (or a 401 anywhere,
 * which clears the cached session) → the login page, with a link back here —
 * unless this tab ended the session on purpose (see sessionEndedOnPurpose; the
 * server may report the end over the event stream before the sign-out request
 * returns, and the page stays mounted for a moment after it did).
 */
export function RequireSession() {
  const queryClient = useQueryClient();
  const session = useSession();
  const location = useLocation();
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
    const onPurpose = sessionEndedOnPurpose.has(queryClient);
    return <Navigate to={onPurpose ? "/login" : loginPath(location)} replace />;
  }
  return (
    <SessionUserContext value={session.data}>
      <Outlet />
    </SessionUserContext>
  );
}
