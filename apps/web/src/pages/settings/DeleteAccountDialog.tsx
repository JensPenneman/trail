import { type FormEvent, useState } from "react";
import { useSessionUser } from "../../app/useSessionUser";
import { useDeleteAccount } from "../../queries/useDeleteAccount";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { TextField } from "../../ui/TextField";

interface DeleteAccountDialogProps {
  open: boolean;
  onClose: () => void;
}

/** The account and everything in it; the email address must be typed again to confirm. */
export function DeleteAccountDialog({ open, onClose }: DeleteAccountDialogProps) {
  const user = useSessionUser();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped("");
  }
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!matches) return;
    remove.mutate({ confirmEmail: typed.trim() });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete your account?"
      description="Your devices, every recorded point, your passkeys and sessions are deleted for good. Export anything you want to keep first."
      size="s"
      dismissible={!remove.isPending}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        <TextField
          label={`Type ${user.email} to confirm`}
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          data-autofocus
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
        {remove.isError ? (
          <ErrorState title="The account was not deleted" error={remove.error} />
        ) : null}
        <div className="dialog__actions">
          <Button onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            icon="trash"
            busy={remove.isPending}
            disabled={!matches}
          >
            Delete account
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
