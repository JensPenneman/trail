import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { EmptyState } from "../../ui/EmptyState";

/**
 * Settings › Access log. A later version of Trail lists here every read of
 * the person's data and every change to who may see it; until then the page
 * says so.
 */
export function AccessLogPage() {
  return (
    <SettingsPage page="access-log">
      <SettingsGroup variant="card">
        <EmptyState icon="history" title="Nothing to show here yet">
          <p>
            A later version of Trail lists here every time your data is read, and every change to
            who may see it — through a browser, the API, an agent, a share or a public link — with
            what was read and when.
          </p>
        </EmptyState>
      </SettingsGroup>
      <SettingsGroup
        title="Related"
        footer="Your own activity is left out of the log unless you choose otherwise."
      >
        <SettingsRow
          kind="link"
          to="/settings/privacy/viewers"
          icon="eye"
          tone="purple"
          label="Who viewed you"
        />
        <SettingsRow
          kind="link"
          to="/settings/preferences#access-log"
          icon="settings"
          tone="gray"
          label="Preferences"
          detail="Whether the log lists your own activity"
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
