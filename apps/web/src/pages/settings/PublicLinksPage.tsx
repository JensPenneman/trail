import type { CreateShareLinkRequest } from "@trail/contracts/shareLink";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { useCreateShareLink } from "../../queries/useCreateShareLink";
import { useDevices } from "../../queries/useDevices";
import { useShareLinks } from "../../queries/useShareLinks";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { type SettingsLocationState, SettingsRow } from "../../settings/SettingsRow";
import { useSettingsShell } from "../../settings/SettingsShellContext";
import { devicesText, historyText, precisionInfo } from "../../sharing/shareText";
import { useNow } from "../../time/useNow";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { linkViewsText } from "./linkText";
import { ShareLinkForm } from "./ShareLinkForm";

/**
 * Settings › Public links: the links that work or recently ended, a page each
 * (what it shows, its views, turning it off), and making a new one — whose
 * address its page then shows, once, with a code to scan.
 */
export function PublicLinksPage() {
  const format = useFormatter();
  const now = useNow(60_000);
  const links = useShareLinks();
  const devices = useDevices();
  const create = useCreateShareLink();
  const announce = useAnnounce();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { freshLinks } = useSettingsShell();
  const [making, setMaking] = useState(false);
  const close = () => {
    create.reset();
    setMaking(false);
  };
  const make = (body: CreateShareLinkRequest) =>
    create.mutate(body, {
      onSuccess: (made) => {
        freshLinks.set(made.link.id, made);
        close();
        announce("The link is ready. Copy it now: it is not shown again.");
        const state: SettingsLocationState = { settingsFrom: pathname };
        void navigate(`/settings/links/${encodeURIComponent(made.link.id)}`, { state });
      },
    });

  return (
    <SettingsPage page="links">
      <SettingsGroup>
        <SettingsRow
          kind="action"
          icon="link"
          tone="teal"
          label="Make a public link"
          onClick={() => setMaking(true)}
        />
      </SettingsGroup>
      {links.isPending ? (
        <LoadingBlock label="Loading links">
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : links.isError ? (
        <ErrorState
          title="Links could not be loaded"
          error={links.error}
          onRetry={() => void links.refetch()}
        />
      ) : (
        <SettingsGroup title="Links" footer="A link that ended stays listed for 30 days.">
          {links.data.length === 0 ? (
            <SettingsRow kind="plain" muted label="No links yet." />
          ) : (
            links.data.map((link) => (
              <SettingsRow
                key={link.id}
                kind="link"
                to={`/settings/links/${encodeURIComponent(link.id)}`}
                label={link.label}
                detail={`${precisionInfo[link.precision].label} · ${historyText(link.historyDays)} · ${devicesText(link.deviceIds, devices.data ?? [], format)} · ${linkViewsText(link, format, now)}`}
                value={link.status === "active" ? "Works" : "Ended"}
              />
            ))
          )}
        </SettingsGroup>
      )}
      <Dialog
        open={making}
        onClose={close}
        title="Make a public link"
        description="A secret address that shows your location to anyone who has it — no account needed — until it ends or you turn it off."
        size="l"
        dismissible={!create.isPending}
      >
        <ShareLinkForm
          busy={create.isPending}
          error={create.error}
          onSubmit={make}
          onCancel={close}
        />
      </Dialog>
    </SettingsPage>
  );
}
