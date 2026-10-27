import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { ProfileForm } from "./ProfileForm";

/** Settings › Profile: the name and the time zone. */
export function ProfilePage() {
  return (
    <SettingsPage page="profile">
      <SettingsGroup variant="card">
        <ProfileForm />
      </SettingsGroup>
    </SettingsPage>
  );
}
