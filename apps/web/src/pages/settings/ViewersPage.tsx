import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { EmptyState } from "../../ui/EmptyState";

/**
 * Settings › Who viewed you. A later version of Trail lists here who looked
 * at the location and how often (the access log); until then the page says so
 * and points to what each page already tells.
 */
export function ViewersPage() {
  return (
    <SettingsPage page="viewers">
      <SettingsGroup variant="card">
        <EmptyState icon="eye" title="Nothing to show here yet">
          <p>
            A later version of Trail lists here who looked at your location — the people you share
            with, the visitors of your public links, your API tokens and agents — how often, and
            when they last did.
          </p>
        </EmptyState>
      </SettingsGroup>
      <SettingsGroup title="Until then">
        <SettingsRow
          kind="link"
          to="/settings/sharing"
          icon="users"
          tone="green"
          label="Sharing"
          detail="When each person last looked"
        />
        <SettingsRow
          kind="link"
          to="/settings/links"
          icon="link"
          tone="teal"
          label="Public links"
          detail="How often each link was opened"
        />
        <SettingsRow
          kind="link"
          to="/settings/tokens"
          icon="code"
          tone="gray"
          label="API tokens"
          detail="When each token was last used, and from where"
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
