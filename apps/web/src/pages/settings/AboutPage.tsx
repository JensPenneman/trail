import { useFormatter } from "../../format/useFormatter";
import { useConfig } from "../../queries/useConfig";
import { useSignOut } from "../../queries/useSignOut";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsFact, SettingsRow } from "../../settings/SettingsRow";
import { ErrorState } from "../../ui/ErrorState";

/** Settings › About: which build runs here, and signing out (the only place for it on phones). */
export function AboutPage() {
  const format = useFormatter();
  const config = useConfig();
  const signOut = useSignOut();
  return (
    <SettingsPage page="about">
      {config.data === undefined ? null : (
        <SettingsGroup variant="facts">
          <SettingsFact label="Version">{config.data.version}</SettingsFact>
          <SettingsFact label="Commit">
            <span className="mono">{config.data.commit}</span>
          </SettingsFact>
          <SettingsFact label="Built">
            {config.data.builtAt === null
              ? "Development build"
              : format.dateTime(config.data.builtAt)}
          </SettingsFact>
          <SettingsFact label="Receiver endpoint">
            <span className="mono">{config.data.ingestUrl}</span>
          </SettingsFact>
        </SettingsGroup>
      )}
      {signOut.isError ? <ErrorState title="Signing out failed" error={signOut.error} /> : null}
      <SettingsGroup>
        <SettingsRow
          kind="action"
          label="Sign out"
          busy={signOut.isPending}
          onClick={() => signOut.mutate()}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
