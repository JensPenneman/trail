import type { Passkey } from "@trail/contracts/passkey";
import { type FormEvent, useState } from "react";
import { useRenamePasskey } from "../../queries/useRenamePasskey";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { errorMessage } from "../../ui/errorMessage";
import { TextField } from "../../ui/TextField";
import { useAnnounce } from "../../ui/useAnnounce";

interface RenamePasskeyDialogProps {
  passkey: Passkey | null;
  onClose: () => void;
}

export function RenamePasskeyDialog({ passkey, onClose }: RenamePasskeyDialogProps) {
  const rename = useRenamePasskey();
  const announce = useAnnounce();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  if ((passkey?.id ?? null) !== shownId) {
    setShownId(passkey?.id ?? null);
    setName(passkey?.name ?? "");
    setError(null);
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passkey === null) return;
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > 60) {
      setError("Use 1 to 60 characters.");
      return;
    }
    rename.mutate(
      { passkeyId: passkey.id, name: trimmed },
      {
        onSuccess: () => {
          announce(`Passkey renamed to ${trimmed}.`);
          onClose();
        },
        onError: (failure) => setError(errorMessage(failure)),
      },
    );
  };

  return (
    <Dialog
      open={passkey !== null}
      onClose={onClose}
      title="Rename passkey"
      size="s"
      dismissible={!rename.isPending}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        <TextField
          label="Name"
          hint="For example the password manager or device that holds it."
          value={name}
          maxLength={60}
          required
          autoComplete="off"
          data-autofocus
          error={error}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className="dialog__actions">
          <Button onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={rename.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
