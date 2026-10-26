import type { OutgoingShare } from "@trail/contracts/share";
import { useStopShare } from "../queries/useStopShare";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorState } from "../ui/ErrorState";
import { useAnnounce } from "../ui/useAnnounce";
import { recipientName } from "./recipientName";

interface StopShareDialogProps {
  share: OutgoingShare | null;
  onClose: () => void;
}

/** "Stop sharing with Ana?" — the share ends the moment it is confirmed. */
export function StopShareDialog({ share, onClose }: StopShareDialogProps) {
  const stop = useStopShare();
  const announce = useAnnounce();
  const name = share === null ? "" : recipientName(share);
  const close = () => {
    stop.reset();
    onClose();
  };
  return (
    <Dialog
      open={share !== null}
      onClose={close}
      title={`Stop sharing with ${name}?`}
      size="s"
      dismissible={!stop.isPending}
    >
      <p>
        {share?.status === "pending"
          ? `${name} will not see you when they sign up.`
          : `${name} no longer sees where you are, from this moment on.`}{" "}
        You can share again at any time.
      </p>
      {stop.isError ? <ErrorState title="Sharing did not stop" error={stop.error} /> : null}
      <div className="dialog__actions">
        <Button onClick={close} disabled={stop.isPending}>
          Cancel
        </Button>
        <Button
          variant="danger"
          busy={stop.isPending}
          onClick={() => {
            if (share === null) return;
            stop.mutate(share.id, {
              onSuccess: () => {
                announce(`You no longer share your location with ${name}.`);
                close();
              },
            });
          }}
        >
          Stop sharing
        </Button>
      </div>
    </Dialog>
  );
}
