import { Navigate, useLocation } from "react-router";
import { settingsPathFor } from "../../app/settingsSections";
import { useSessionUser } from "../../app/useSessionUser";

/** `/settings` opens Profile; an anchor of the single page of old opens its section. */
export function SettingsIndex() {
  const { hash } = useLocation();
  const user = useSessionUser();
  return <Navigate to={settingsPathFor(hash, user.isAdmin)} replace />;
}
