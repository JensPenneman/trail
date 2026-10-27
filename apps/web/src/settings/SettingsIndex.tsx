import { Navigate, useLocation } from "react-router";
import { useSessionUser } from "../app/useSessionUser";
import { useMediaQuery } from "../ui/useMediaQuery";
import { SettingsNavigation } from "./SettingsNavigation";
import { SettingsPage } from "./SettingsPage";
import { firstSettingsPath, settingsPathFor } from "./settingsTree";
import { sideBySide } from "./sideBySide";

/**
 * `/settings`: the list of Settings with search, a page of its own on phones;
 * where the list stands beside the page it opens the first page. An anchor of
 * the single Settings page of old (`#tokens`) opens its page.
 */
export function SettingsIndex() {
  const { hash } = useLocation();
  const user = useSessionUser();
  const wide = useMediaQuery(sideBySide);
  const moved = settingsPathFor(hash, user.isAdmin);
  if (moved !== null) return <Navigate to={moved} replace />;
  if (wide) return <Navigate to={firstSettingsPath} replace />;
  return (
    <SettingsPage>
      <SettingsNavigation placement="root" />
    </SettingsPage>
  );
}
