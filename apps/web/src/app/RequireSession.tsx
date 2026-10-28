import { useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router";
import { sessionEndedOnPurpose } from "../queries/sessionEndedOnPurpose";
import { useSession } from "../queries/useSession";
import { AppLoading } from "./AppLoading";
import { loginPath } from "./loginPath";
import { ServerUnavailable } from "./ServerUnavailable";
import { SessionUserContext } from "./SessionUserContext";
import { useOfflineSession } from "./useOfflineSession";

/**
 * Signed-in routes render only with a session. Signed out (or a 401 anywhere,
 * which clears the cached session) → the login page, with a link back here —
 * unless this tab ended the session on purpose (see sessionEndedOnPurpose; the
 * server may report the end over the event stream before the sign-out request
 * returns, and the page stays mounted for a moment after it did). While the
 * session cannot be checked at all (offline, or the server unreachable), the
 * pages paint from this browser's copy, as the account it belongs to.
 */
export function RequireSession() {
  const queryClient = useQueryClient();
  const session = useSession();
  const location = useLocation();
  const offline = useOfflineSession(session);
  if (session.data === undefined) {
    if (offline.user !== null) {
      return (
        <SessionUserContext value={offline.user}>
          <Outlet />
        </SessionUserContext>
      );
    }
    if (session.isError && !offline.looking) {
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
