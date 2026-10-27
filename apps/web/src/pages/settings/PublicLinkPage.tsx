import type { ShareLink } from "@trail/contracts/shareLink";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { LinkUsage } from "../../accessLog/LinkUsage";
import { useFormatter } from "../../format/useFormatter";
import { useDevices } from "../../queries/useDevices";
import { useShareLinks } from "../../queries/useShareLinks";
import { useTurnOffShareLink } from "../../queries/useTurnOffShareLink";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsFact, SettingsRow } from "../../settings/SettingsRow";
import { useSettingsShell } from "../../settings/SettingsShellContext";
import { settingsPage } from "../../settings/settingsTree";
import { useLeaveTo } from "../../settings/useLeaveTo";
import { devicesText, historyText, precisionInfo } from "../../sharing/shareText";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { CopyField } from "../../ui/CopyField";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { QrCode } from "../../ui/QrCode";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { linkViewsText } from "./linkText";
import { MissingItem } from "./MissingItem";
import "./settings.css";

/**
 * Settings › Public links › one link: what it shows and until when, how often
 * it was opened and by how many visitors, per day (the access log), and
 * turning it off. Right after it was made, the page shows
 * its address with a code to scan — once: Trail keeps only a fingerprint of
 * the secret in it.
 */
export function PublicLinkPage() {
  const { linkId = "" } = useParams();
  const format = useFormatter();
  const now = useNow(60_000);
  const links = useShareLinks();
  const devices = useDevices();
  const turnOff = useTurnOffShareLink();
  const announce = useAnnounce();
  const leave = useLeaveTo(settingsPage("links").path);
  const { freshLinks } = useSettingsShell();
  const [made] = useState(() => freshLinks.get(linkId));
  // Shown on this visit of the page only: gone with it, never in the browser's history.
  useEffect(() => () => void freshLinks.delete(linkId), [freshLinks, linkId]);
  const [confirming, setConfirming] = useState(false);
  const [removed, setRemoved] = useState<ShareLink | null>(null);
  const link =
    links.data?.find((candidate) => candidate.id === linkId) ?? removed ?? made?.link ?? null;

  if (link === null && (links.isPending || links.isError)) {
    return (
      <SettingsPage parent="links" title="Public link">
        {links.isPending ? (
          <LoadingBlock label="Loading the link">
            <Skeleton height="14rem" />
          </LoadingBlock>
        ) : (
          <ErrorState
            title="The link could not be loaded"
            error={links.error}
            onRetry={() => void links.refetch()}
          />
        )}
      </SettingsPage>
    );
  }
  if (link === null) return <MissingItem parent="links" item="Public link" />;

  const active = link.status === "active" && Date.parse(link.expiresAt) > now;
  const remove = () =>
    turnOff.mutate(link.id, {
      onSuccess: () => {
        announce(active ? "The link is turned off." : "Link removed.");
        setConfirming(false);
        setRemoved(link);
        leave();
      },
    });
  return (
    <SettingsPage parent="links" title={link.label}>
      {made === undefined ? null : (
        <SettingsGroup title="Your link is ready" variant="card">
          <div className="settings__link-result">
            <QrCode value={made.url} label="Code with the public link to your location" />
            <div className="stack">
              <CopyField label="Public link" value={made.url} mono={false} />
              <p className="muted">
                Anyone with this link sees your location until{" "}
                {format.dateTime(made.link.expiresAt)}. It is shown only now: copy it or let them
                scan the code.
              </p>
            </div>
          </div>
        </SettingsGroup>
      )}
      {turnOff.isError ? (
        <ErrorState title="The link was not turned off" error={turnOff.error} />
      ) : null}
      <SettingsGroup
        title="What it shows"
        variant="facts"
        footer={
          made === undefined
            ? "Its address was shown once, when you made it: Trail keeps only a fingerprint of it, so it cannot show the address or its code again. Make a new link to share one."
            : undefined
        }
      >
        <SettingsFact label="Status">{active ? "Works" : "Ended"}</SettingsFact>
        <SettingsFact label="Precision">{precisionInfo[link.precision].short}</SettingsFact>
        <SettingsFact label="History">{historyText(link.historyDays)}</SettingsFact>
        <SettingsFact label="Devices">
          {devicesText(link.deviceIds, devices.data ?? [], format)}
        </SettingsFact>
        <SettingsFact label="Battery and activity">
          {link.includeDetails ? "Shown" : "Not shown"}
        </SettingsFact>
        <SettingsFact label={active ? "Works until" : "Ended"}>
          {format.dateTime(link.expiresAt)}
        </SettingsFact>
        <SettingsFact label="Views">{linkViewsText(link, format, now)}</SettingsFact>
        <SettingsFact label="Made">{format.dateTime(link.createdAt)}</SettingsFact>
      </SettingsGroup>
      <LinkUsage linkId={link.id} />
      <SettingsGroup>
        {active ? (
          <SettingsRow
            kind="action"
            danger
            label="Turn off link"
            onClick={() => setConfirming(true)}
          />
        ) : (
          <SettingsRow
            kind="action"
            danger
            label="Remove link"
            busy={turnOff.isPending}
            onClick={remove}
          />
        )}
      </SettingsGroup>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Turn off “${link.label}”?`}
        size="s"
        dismissible={!turnOff.isPending}
      >
        <p>Whoever has the link sees nothing from now on. A link cannot be turned on again.</p>
        <div className="dialog__actions">
          <Button onClick={() => setConfirming(false)} disabled={turnOff.isPending}>
            Cancel
          </Button>
          <Button variant="danger" busy={turnOff.isPending} onClick={remove}>
            Turn off
          </Button>
        </div>
      </Dialog>
    </SettingsPage>
  );
}
