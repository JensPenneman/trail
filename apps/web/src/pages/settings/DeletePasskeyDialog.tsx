import type { Passkey } from "@trail/contracts/passkey";
import { ApiError } from "../../api/ApiError";
import { useDeletePasskey } from "../../queries/useDeletePasskey";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { Notice } from "../../ui/Notice";
import { useAnnounce } from "../../ui/useAnnounce";

interface DeletePasskeyDialogProps {
  passkey: Passkey | null;
  onClose: () => void;
}

export function DeletePasskeyDialog({ passkey, onClose }: DeletePasskeyDialogProps) {
  const remove = useDeletePasskey();
  const announce = useAnnounce();
  const last = remove.error instanceof ApiError && remove.error.code === "last_passkey";
  const close = () => {
    remove.reset();
    onClose();
  };
  return (
    <Dialog
      open={passkey !== null}
      onClose={close}
      title={`Delete “${passkey?.name ?? "passkey"}”?`}
      size="s"
      dismissible={!remove.isPending}
    >
      <p>
        You can no longer sign in with it. The password manager may keep offering it until you
        remove it there as well.
      </p>
      {last ? (
        <Notice tone="warning" role="alert" title="This is your only passkey">
          <p>Add another passkey first, so you can still sign in afterwards.</p>
        </Notice>
      ) : remove.isError ? (
        <ErrorState title="The passkey was not deleted" error={remove.error} />
      ) : null}
      <div className="dialog__actions">
        <Button onClick={close} disabled={remove.isPending}>
          Cancel
        </Button>
        <Button
          variant="danger"
          icon="trash"
          busy={remove.isPending}
          disabled={last}
          onClick={() => {
            if (passkey === null) return;
            remove.mutate(passkey.id, {
              onSuccess: () => {
                announce("Passkey deleted.");
                close();
              },
            });
          }}
        >
          Delete passkey
        </Button>
      </div>
    </Dialog>
  );
}
