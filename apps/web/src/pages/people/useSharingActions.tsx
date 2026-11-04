import type { UseQueryResult } from "@tanstack/react-query";
import type { Person } from "@trail/contracts/person";
import type { OutgoingShare } from "@trail/contracts/share";
import { type ReactNode, useState } from "react";
import { useReadOnly } from "../../app/useReadOnly";
import { useHidePerson } from "../../queries/useHidePerson";
import { useShares } from "../../queries/useShares";
import { ShareDialog, type ShareDialogMode } from "../../sharing/ShareDialog";
import { StopShareDialog } from "../../sharing/StopShareDialog";
import { OfflineReason } from "../../ui/OfflineReason";
import { useAnnounce } from "../../ui/useAnnounce";

/** The id of the sentence that says why sharing cannot be changed offline. */
export const shareOfflineId = "share-offline-reason";

export interface SharingActions {
  shares: UseQueryResult<OutgoingShare[]>;
  /** The share the signed-in person gives someone, by their account or their address. */
  shareWith: (person: Person) => OutgoingShare | null;
  /** The Share my location dialog, for an address or for anyone. */
  openShare: (email?: string) => void;
  /** The confirmation before one stops sharing with someone. */
  openStop: (share: OutgoingShare) => void;
  /** Hides someone and announces it; `onHidden` then leaves their detail. */
  hide: (person: Person, onHidden: () => void) => void;
  hiding: (shareId: string) => boolean;
  hideError: unknown;
  /** Why sharing is off while offline, for the controls it describes; null online. */
  offlineReason: ReactNode;
  /** The two dialogs, to render once. */
  dialogs: ReactNode;
}

/**
 * What the People page does with the shares of the signed-in person, which
 * its list and its detail both offer: share, share back, stop, hide.
 */
export function useSharingActions(people: readonly Person[]): SharingActions {
  const shares = useShares();
  const hideMutation = useHidePerson();
  const announce = useAnnounce();
  const readOnly = useReadOnly();
  const [dialog, setDialog] = useState<ShareDialogMode | null>(null);
  const [stopping, setStopping] = useState<OutgoingShare | null>(null);
  const outgoing = shares.data ?? [];
  const shareWith = (person: Person) =>
    outgoing.find(
      (share) => share.recipient.userId === person.userId || share.recipient.email === person.email,
    ) ?? null;
  const suggestions = people
    .filter((person) => shareWith(person) === null)
    .map((person) => ({ name: person.displayName, email: person.email }));
  return {
    shares,
    shareWith,
    openShare: (email) =>
      setDialog(email === undefined ? { kind: "create" } : { kind: "create", email }),
    openStop: setStopping,
    hide: (person, onHidden) =>
      hideMutation.mutate(
        { shareId: person.share.id, hidden: true },
        {
          onSuccess: () => {
            onHidden();
            announce(`${person.displayName} is hidden. Show them again under Hidden.`);
          },
        },
      ),
    hiding: (shareId) => hideMutation.isPending && hideMutation.variables.shareId === shareId,
    hideError: hideMutation.isError ? hideMutation.error : null,
    offlineReason: readOnly ? (
      <OfflineReason id={shareOfflineId}>
        You’re offline: whom you share with can be changed once you reconnect.
      </OfflineReason>
    ) : null,
    dialogs: (
      <>
        <ShareDialog mode={dialog} onClose={() => setDialog(null)} suggestions={suggestions} />
        <StopShareDialog share={stopping} onClose={() => setStopping(null)} />
      </>
    ),
  };
}
