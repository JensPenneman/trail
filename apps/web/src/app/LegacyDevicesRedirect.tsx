import { Navigate, useLocation } from "react-router";
import { legacyDevicesPath } from "./legacyDevicesPath";

/**
 * `/devices` and `/devices/<id>`: the same page in Settings, in place of the
 * old address in the history. A component rather than a loader, which would
 * lose the anchor (a request's address has none).
 */
export function LegacyDevicesRedirect() {
  return <Navigate to={legacyDevicesPath(useLocation())} replace />;
}
