import type { OutgoingShare } from "@trail/contracts/share";
import { useState } from "react";
import { useParams } from "react-router";
import { ShareUsage } from "../../accessLog/ShareUsage";
import { useFormatter } from "../../format/useFormatter";
import { useConfirmShare } from "../../queries/useConfirmShare";
import { useDevices } from "../../queries/useDevices";
import { useShares } from "../../queries/useShares";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsFact, SettingsRow } from "../../settings/SettingsRow";
import { settingsPage } from "../../settings/settingsTree";
import { useLeaveTo } from "../../settings/useLeaveTo";
import { recipientName } from "../../sharing/recipientName";
import { ShareDialog, type ShareDialogMode } from "../../sharing/ShareDialog";
import { StopShareDialog } from "../../sharing/StopShareDialog";
import { devicesText, historyText, precisionInfo } from "../../sharing/shareText";
import { useNow } from "../../time/useNow";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { MissingItem } from "./MissingItem";
import { shareStatusLabels } from "./shareStatus";

/**
 * Settings › Sharing › one person: what they see of you — devices, precision,
 * history, details — until when, when they last looked and at what (the
 * access log); change it or stop.
 */
export function SharePage() {
  const { shareId } = useParams();
  const format = useFormatter();
  const now = useNow(60_000);
  const shares = useShares();
  const devices = useDevices();
  const confirm = useConfirmShare();
  const announce = useAnnounce();
  const leave = useLeaveTo(settingsPage("sharing").path);
  const [dialog, setDialog] = useState<ShareDialogMode | null>(null);
  const [stopping, setStopping] = useState(false);
  // Once stopped, the page shows what it showed until it has gone back to the list.
  const [stopped, setStopped] = useState<OutgoingShare | null>(null);
  const share = shares.data?.find((candidate) => candidate.id === shareId) ?? stopped;

  if (shares.isPending || shares.isError) {
    return (
      <SettingsPage parent="sharing" title="Share">
        {shares.isPending ? (
          <LoadingBlock label="Loading the share">
            <Skeleton height="14rem" />
          </LoadingBlock>
        ) : (
          <ErrorState
            title="The share could not be loaded"
            error={shares.error}
            onRetry={() => void shares.refetch()}
          />
        )}
      </SettingsPage>
    );
  }
  if (share === null || share === undefined) return <MissingItem parent="sharing" item="Share" />;

  const name = recipientName(share);
  const joined = share.status === "joined";
  return (
    <SettingsPage
      parent="sharing"
      title={name}
      description={share.recipient.displayName === null ? undefined : share.recipient.email}
    >
      {joined ? (
        <Notice tone="warning" title={`Someone signed up as ${share.recipient.email}`}>
          <p>
            {name} sees nothing until you confirm it is the person you meant: Trail does not check
            email addresses.
          </p>
        </Notice>
      ) : null}
      {confirm.isError ? (
        <ErrorState title="The share was not confirmed" error={confirm.error} />
      ) : null}
      <SettingsGroup title="What they see" variant="facts">
        <SettingsFact label="Status">{shareStatusLabels[share.status]}</SettingsFact>
        <SettingsFact label="Devices">
          {devicesText(share.deviceIds, devices.data ?? [], format)}
        </SettingsFact>
        <SettingsFact label="Precision">{precisionInfo[share.precision].short}</SettingsFact>
        <SettingsFact label="History">{historyText(share.historyDays)}</SettingsFact>
        <SettingsFact label="Battery and activity">
          {share.includeDetails ? "Shared" : "Not shared"}
        </SettingsFact>
        <SettingsFact label="Ends">
          {share.expiresAt === null
            ? "When you stop it"
            : Date.parse(share.expiresAt) <= now
              ? "Ended"
              : format.dateTime(share.expiresAt)}
        </SettingsFact>
        <SettingsFact label="Last looked">
          {share.lastViewedAt === null ? "Not yet" : format.relative(share.lastViewedAt, now)}
        </SettingsFact>
        <SettingsFact label="Shared since">{format.dateTime(share.createdAt)}</SettingsFact>
      </SettingsGroup>
      {share.recipient.userId === null ? null : (
        <ShareUsage userId={share.recipient.userId} name={name} />
      )}
      <SettingsGroup>
        {joined ? (
          <SettingsRow
            kind="action"
            label={`Confirm it is ${name}`}
            busy={confirm.isPending}
            onClick={() =>
              confirm.mutate(share.id, {
                onSuccess: () => announce(`${name} can see your location now.`),
              })
            }
          />
        ) : (
          <SettingsRow
            kind="action"
            label="Change what they see"
            onClick={() => setDialog({ kind: "edit", share })}
          />
        )}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          kind="action"
          danger
          label={joined ? "Cancel the share" : "Stop sharing"}
          onClick={() => setStopping(true)}
        />
      </SettingsGroup>
      <ShareDialog mode={dialog} onClose={() => setDialog(null)} suggestions={[]} />
      <StopShareDialog
        share={stopping ? share : null}
        onClose={() => setStopping(false)}
        onStopped={() => {
          setStopped(share);
          leave();
        }}
      />
    </SettingsPage>
  );
}
