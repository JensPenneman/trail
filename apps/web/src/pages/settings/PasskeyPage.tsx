import type { Passkey } from "@trail/contracts/passkey";
import { useState } from "react";
import { useParams } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { usePasskeys } from "../../queries/usePasskeys";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsFact, SettingsRow } from "../../settings/SettingsRow";
import { settingsPage } from "../../settings/settingsTree";
import { useLeaveTo } from "../../settings/useLeaveTo";
import { useNow } from "../../time/useNow";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { DeletePasskeyDialog } from "./DeletePasskeyDialog";
import { MissingItem } from "./MissingItem";
import { RenamePasskeyDialog } from "./RenamePasskeyDialog";

/** Settings › Passkeys › one passkey: where it lives and works, when it was used; rename, delete. */
export function PasskeyPage() {
  const { passkeyId } = useParams();
  const format = useFormatter();
  const now = useNow(60_000);
  const passkeys = usePasskeys();
  const leave = useLeaveTo(settingsPage("passkeys").path);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Once deleted, the page shows what it showed until it has gone back to the list.
  const [deleted, setDeleted] = useState<Passkey | null>(null);
  const passkey = passkeys.data?.find((candidate) => candidate.id === passkeyId) ?? deleted;

  if (passkeys.isPending || passkeys.isError) {
    return (
      <SettingsPage parent="passkeys" title="Passkey">
        {passkeys.isPending ? (
          <LoadingBlock label="Loading the passkey">
            <Skeleton height="12rem" />
          </LoadingBlock>
        ) : (
          <ErrorState
            title="The passkey could not be loaded"
            error={passkeys.error}
            onRetry={() => void passkeys.refetch()}
          />
        )}
      </SettingsPage>
    );
  }
  if (passkey === null || passkey === undefined)
    return <MissingItem parent="passkeys" item="Passkey" />;

  return (
    <SettingsPage parent="passkeys" title={passkey.name}>
      <SettingsGroup variant="facts">
        <SettingsFact label="Kept by">{passkey.provider ?? "Unknown provider"}</SettingsFact>
        <SettingsFact label="Synced">
          {passkey.backedUp ? "Yes, to your other devices" : "No, it stays on one device"}
        </SettingsFact>
        <SettingsFact label="Works on">
          {passkey.usableHere ? `This address (${passkey.rpId})` : passkey.rpId}
        </SettingsFact>
        <SettingsFact label="Added">{format.dateTime(passkey.createdAt)}</SettingsFact>
        <SettingsFact label="Last used">
          {passkey.lastUsedAt === null ? "Never" : format.relative(passkey.lastUsedAt, now)}
        </SettingsFact>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow kind="action" label="Rename" onClick={() => setRenaming(true)} />
      </SettingsGroup>
      <SettingsGroup footer="You can no longer sign in with it here. Your password manager may keep offering it until you remove it there too.">
        <SettingsRow
          kind="action"
          danger
          label="Delete passkey"
          onClick={() => setDeleting(true)}
        />
      </SettingsGroup>
      <RenamePasskeyDialog passkey={renaming ? passkey : null} onClose={() => setRenaming(false)} />
      <DeletePasskeyDialog
        passkey={deleting ? passkey : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleted(passkey);
          leave();
        }}
      />
    </SettingsPage>
  );
}
