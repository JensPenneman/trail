import type { DeviceWithCredentialsResponse } from "@trail/contracts/device";
import { useState } from "react";
import { CredentialsView } from "../../devices/CredentialsView";
import { UploadWait } from "../../devices/UploadWait";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { LinkButton } from "../../ui/LinkButton";
import { AddDeviceNameForm } from "./AddDeviceNameForm";
import "./AddDeviceDialog.css";

interface AddDeviceDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Adding a phone: name it, then show the one-time credentials (QR code first)
 * and wait until its first upload arrives.
 */
export function AddDeviceDialog({ open, onClose }: AddDeviceDialogProps) {
  const [created, setCreated] = useState<DeviceWithCredentialsResponse | null>(null);
  const close = () => {
    onClose();
    setCreated(null);
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={created === null ? "Add a device" : `Set up ${created.device.name}`}
      description={
        created === null
          ? "A phone running Overland for iOS. It gets its own access token."
          : "Connect Overland on the phone to Trail."
      }
      size={created === null ? "s" : "l"}
    >
      {created === null ? (
        <AddDeviceNameForm onCreated={setCreated} onCancel={close} />
      ) : (
        <>
          <CredentialsView
            deviceName={created.device.name}
            credentials={created.credentials}
            status={
              <UploadWait
                deviceId={created.device.id}
                deviceName={created.device.name}
                after={created.device.lastSeenAt}
                reason="new-device"
              />
            }
          />
          <div className="dialog__actions">
            <LinkButton to={`/devices/${created.device.id}`} onClick={close}>
              Open device page
            </LinkButton>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
