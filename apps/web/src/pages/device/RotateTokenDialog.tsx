import type { DeviceSummary, DeviceWithCredentialsResponse } from "@trail/contracts/device";
import { useState } from "react";
import { CredentialsView } from "../../devices/CredentialsView";
import { UploadWait } from "../../devices/UploadWait";
import { useRotateDeviceToken } from "../../queries/useRotateDeviceToken";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { Notice } from "../../ui/Notice";

interface RotateTokenDialogProps {
  device: DeviceSummary;
  open: boolean;
  onClose: () => void;
}

/**
 * Replaces the device's access token (lost token, or a phone that changed
 * hands) and shows the setup code again for the new one.
 */
export function RotateTokenDialog({ device, open, onClose }: RotateTokenDialogProps) {
  const rotate = useRotateDeviceToken(device.id);
  const [issued, setIssued] = useState<{
    response: DeviceWithCredentialsResponse;
    lastSeenAt: string | null;
  } | null>(null);
  const close = () => {
    onClose();
    setIssued(null);
    rotate.reset();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={issued === null ? "Issue a new access token?" : `New token for ${device.name}`}
      size={issued === null ? "s" : "l"}
      dismissible={!rotate.isPending}
    >
      {issued === null ? (
        <>
          <Notice tone="warning" title="The current token stops working immediately">
            <p>
              {device.name} can only send again once Overland has the new token. The phone keeps its
              unsent points and delivers them after that.
            </p>
          </Notice>
          {rotate.isError ? (
            <ErrorState title="No new token was issued" error={rotate.error} />
          ) : null}
          <div className="dialog__actions">
            <Button onClick={close} disabled={rotate.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon="refresh"
              busy={rotate.isPending}
              onClick={() =>
                rotate.mutate(undefined, {
                  onSuccess: (response) => setIssued({ response, lastSeenAt: device.lastSeenAt }),
                })
              }
            >
              Issue new token
            </Button>
          </div>
        </>
      ) : (
        <>
          <CredentialsView
            deviceName={device.name}
            credentials={issued.response.credentials}
            status={
              <UploadWait
                deviceId={device.id}
                deviceName={device.name}
                after={issued.lastSeenAt}
                reason="new-token"
              />
            }
          />
          <div className="dialog__actions">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
