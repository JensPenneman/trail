import { useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useDevices } from "../../queries/useDevices";
import { useShares } from "../../queries/useShares";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { recipientName } from "../../sharing/recipientName";
import { ShareDialog, type ShareDialogMode } from "../../sharing/ShareDialog";
import { devicesText, historyText, precisionInfo } from "../../sharing/shareText";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { shareStatusLabels } from "./shareStatus";

/**
 * Settings › Sharing: the people who see the signed-in person's location, a
 * page each (what they see, changing it, stopping), and sharing with someone
 * new.
 */
export function SharingPage() {
  const format = useFormatter();
  const shares = useShares();
  const devices = useDevices();
  const [dialog, setDialog] = useState<ShareDialogMode | null>(null);
  return (
    <SettingsPage page="sharing">
      <SettingsGroup>
        <SettingsRow
          kind="action"
          icon="users"
          tone="green"
          label="Share my location"
          onClick={() => setDialog({ kind: "create" })}
        />
      </SettingsGroup>
      {shares.isPending ? (
        <LoadingBlock label="Loading your shares">
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : shares.isError ? (
        <ErrorState
          title="Your shares could not be loaded"
          error={shares.error}
          onRetry={() => void shares.refetch()}
        />
      ) : (
        <SettingsGroup
          title="You share with"
          id="shares"
          footer="One way: you see them only if they share with you too."
        >
          {shares.data.length === 0 ? (
            <SettingsRow kind="plain" muted label="Nobody sees your location." />
          ) : (
            shares.data.map((share) => (
              <SettingsRow
                key={share.id}
                kind="link"
                to={`/settings/sharing/${encodeURIComponent(share.id)}`}
                label={recipientName(share)}
                detail={`${precisionInfo[share.precision].label} · ${historyText(share.historyDays)} · ${devicesText(share.deviceIds, devices.data ?? [], format)}`}
                value={shareStatusLabels[share.status]}
              />
            ))
          )}
        </SettingsGroup>
      )}
      <ShareDialog mode={dialog} onClose={() => setDialog(null)} suggestions={[]} />
    </SettingsPage>
  );
}
