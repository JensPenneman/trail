import type { OutgoingShare } from "@trail/contracts/share";
import { useState } from "react";
import { useDevices } from "../../queries/useDevices";
import { useShares } from "../../queries/useShares";
import { OutgoingShareList } from "../../sharing/OutgoingShareList";
import { ShareDialog, type ShareDialogMode } from "../../sharing/ShareDialog";
import { StopShareDialog } from "../../sharing/StopShareDialog";
import { useNow } from "../../time/useNow";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { ShareLinkForm } from "./ShareLinkForm";
import { ShareLinkList } from "./ShareLinkList";

/**
 * Sharing: public links for people without an account, and the people the
 * signed-in person shares with (People links here with how many they are).
 */
export function SharingSection({ headingId }: { headingId: string }) {
  const shares = useShares();
  const devices = useDevices();
  const now = useNow(60_000);
  const [dialog, setDialog] = useState<ShareDialogMode | null>(null);
  const [stopping, setStopping] = useState<OutgoingShare | null>(null);
  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId} tabIndex={-1} data-section-title>
        Sharing
      </h2>
      <div className="card">
        <h3 className="settings__subtitle">Make a public link</h3>
        <p>
          A secret address that shows your location to anyone who has it — no account needed — until
          it expires or you turn it off.
        </p>
        <ShareLinkForm />
      </div>
      <div className="card card--flush">
        <h3 className="settings__subtitle settings__subtitle--padded">Public links</h3>
        <ShareLinkList />
      </div>
      <div className="card card--flush">
        <h3 className="settings__subtitle settings__subtitle--padded">You share with</h3>
        {shares.isPending ? (
          <LoadingBlock label="Loading your shares">
            <Skeleton height="3rem" />
          </LoadingBlock>
        ) : shares.isError ? (
          <div className="settings__padded">
            <ErrorState
              title="Your shares could not be loaded"
              error={shares.error}
              onRetry={() => void shares.refetch()}
            />
          </div>
        ) : shares.data.length === 0 ? (
          <div className="settings__padded cluster">
            <p className="muted">Nobody sees your location.</p>
            <LinkButton to="/" icon="users">
              Share it on People
            </LinkButton>
          </div>
        ) : (
          <OutgoingShareList
            shares={shares.data}
            devices={devices.data ?? []}
            now={now}
            onChange={(share) => setDialog({ kind: "edit", share })}
            onStop={setStopping}
          />
        )}
      </div>
      <ShareDialog mode={dialog} onClose={() => setDialog(null)} suggestions={[]} />
      <StopShareDialog share={stopping} onClose={() => setStopping(null)} />
    </section>
  );
}
