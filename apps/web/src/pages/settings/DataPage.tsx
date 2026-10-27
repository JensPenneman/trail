import { useState } from "react";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { DeleteRangeForm } from "./DeleteRangeForm";
import { ExportForm } from "./ExportForm";

/** Settings › Your data: take it out, remove some of it, or remove all of it. */
export function DataPage() {
  const [deletingAccount, setDeletingAccount] = useState(false);
  return (
    <SettingsPage page="data">
      <SettingsGroup title="Export" id="export" variant="card">
        <ExportForm />
      </SettingsGroup>
      <SettingsGroup title="Delete a period" id="delete-period" variant="card">
        <DeleteRangeForm />
      </SettingsGroup>
      <SettingsGroup
        title="Delete account"
        id="delete-account"
        footer="Removes you, your devices and all of their data from this server."
      >
        <SettingsRow
          kind="action"
          danger
          label="Delete account…"
          onClick={() => setDeletingAccount(true)}
        />
      </SettingsGroup>
      <DeleteAccountDialog open={deletingAccount} onClose={() => setDeletingAccount(false)} />
    </SettingsPage>
  );
}
