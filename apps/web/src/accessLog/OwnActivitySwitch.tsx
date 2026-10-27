import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingsRow } from "../settings/SettingsRow";
import { ErrorState } from "../ui/ErrorState";
import type { OwnActivity } from "./useOwnActivity";

/** The switch for one's own activity, on the pages it changes; it saves the preference. */
export function OwnActivitySwitch({ own }: { own: OwnActivity }) {
  return (
    <>
      {own.error === null ? null : (
        <ErrorState title="That choice was not saved" error={own.error} />
      )}
      <SettingsGroup footer="Kept for every browser you sign in on, as in Preferences.">
        <SettingsRow
          kind="switch"
          icon="user"
          tone="indigo"
          label="Your own activity"
          detail="Also count what you did yourself, signed in."
          checked={own.showOwn}
          onChange={own.setShowOwn}
        />
      </SettingsGroup>
    </>
  );
}
