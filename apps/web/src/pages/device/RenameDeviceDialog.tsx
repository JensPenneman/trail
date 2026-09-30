import type { DeviceSummary } from "@trail/contracts/device";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/ApiError";
import { useUpdateDevice } from "../../queries/useUpdateDevice";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { errorMessage } from "../../ui/errorMessage";
import { TextField } from "../../ui/TextField";
import { useAnnounce } from "../../ui/useAnnounce";

interface RenameDeviceDialogProps {
  device: DeviceSummary;
  open: boolean;
  onClose: () => void;
}

export function RenameDeviceDialog({ device, open, onClose }: RenameDeviceDialogProps) {
  const update = useUpdateDevice(device.id);
  const announce = useAnnounce();
  const [name, setName] = useState(device.name);
  const [error, setError] = useState<string | null>(null);
  // Every opening starts from the device's current name.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(device.name);
      setError(null);
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > 60) {
      setError("Use 1 to 60 characters.");
      return;
    }
    update.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          announce(`Renamed to ${trimmed}.`);
          onClose();
        },
        onError: (failure) =>
          setError(
            failure instanceof ApiError
              ? (failure.fields["name"]?.join(" ") ?? failure.message)
              : errorMessage(failure),
          ),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename device"
      size="s"
      dismissible={!update.isPending}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        <TextField
          label="Name"
          value={name}
          maxLength={60}
          required
          autoComplete="off"
          data-autofocus
          error={error}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className="dialog__actions">
          <Button onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
