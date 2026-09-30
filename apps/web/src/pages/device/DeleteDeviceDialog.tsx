import type { DeviceSummary } from "@trail/contracts/device";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { useDeleteDevice } from "../../queries/useDeleteDevice";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { TextField } from "../../ui/TextField";
import { useAnnounce } from "../../ui/useAnnounce";

interface DeleteDeviceDialogProps {
  device: DeviceSummary;
  open: boolean;
  onClose: () => void;
}

/** Deleting removes every point the device ever recorded, so the name must be typed to confirm. */
export function DeleteDeviceDialog({ device, open, onClose }: DeleteDeviceDialogProps) {
  const format = useFormatter();
  const remove = useDeleteDevice(device.id);
  const navigate = useNavigate();
  const announce = useAnnounce();
  const [typed, setTyped] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped("");
  }
  const matches = typed.trim() === device.name.trim();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!matches) return;
    remove.mutate(undefined, {
      onSuccess: () => {
        announce(`${device.name} was deleted.`);
        void navigate("/devices", { replace: true });
      },
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete ${device.name}?`}
      description={`This removes the device and all ${format.count(device.counts.total)} of its points, visits and trips for good.`}
      size="s"
      dismissible={!remove.isPending}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        <TextField
          label={`Type “${device.name}” to confirm`}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
        {remove.isError ? (
          <ErrorState title="The device was not deleted" error={remove.error} />
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
            Delete device
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
