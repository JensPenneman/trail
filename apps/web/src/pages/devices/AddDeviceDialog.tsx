import type { DeviceWithCredentialsResponse } from "@trail/contracts/device";
import { deviceAppInfo } from "@trail/contracts/deviceApp";
import { useState } from "react";
import { CredentialsView } from "../../devices/CredentialsView";
import { devicePath } from "../../devices/devicePaths";
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
 * Adding a phone: name it and choose its app, then show the one-time
 * credentials for that app (a setup code first, where the app takes one) and
 * wait until its first upload arrives.
 */
export function AddDeviceDialog({ open, onClose }: AddDeviceDialogProps) {
  const [created, setCreated] = useState<DeviceWithCredentialsResponse | null>(null);
  // Forgotten once the dialog is closed: `open` follows the URL, which changes a moment
  // after the close, and in between the dialog must not show the name form again.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setCreated(null);
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={created === null ? "Add a device" : `Set up ${created.device.name}`}
      description={
        created === null
          ? "A phone with a tracking app. It gets its own access token."
          : `Connect ${deviceAppInfo[created.device.source].name} on the phone to Trail.`
      }
      size={created === null ? "s" : "l"}
    >
      {created === null ? (
        <AddDeviceNameForm onCreated={setCreated} onCancel={onClose} />
      ) : (
        <>
          <CredentialsView
            deviceName={created.device.name}
            credentials={created.credentials}
            status={
              <UploadWait
                deviceId={created.device.id}
                deviceName={created.device.name}
                app={created.device.source}
                after={created.device.lastSeenAt}
                reason="new-device"
              />
            }
          />
          <div className="dialog__actions">
            <LinkButton to={devicePath(created.device.id)} onClick={onClose}>
              Open device page
            </LinkButton>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
