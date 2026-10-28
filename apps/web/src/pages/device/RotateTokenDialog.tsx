import type { DeviceSummary, DeviceWithCredentialsResponse } from "@trail/contracts/device";
import { type DeviceApp, deviceAppInfo } from "@trail/contracts/deviceApp";
import { useState } from "react";
import { CredentialsView } from "../../devices/CredentialsView";
import { UploadWait } from "../../devices/UploadWait";
import { useRotateDeviceToken } from "../../queries/useRotateDeviceToken";
import { Button } from "../../ui/Button";
import { ChoiceList } from "../../ui/ChoiceList";
import { Dialog } from "../../ui/Dialog";
import { ErrorState } from "../../ui/ErrorState";
import { Notice } from "../../ui/Notice";
import { appChoices } from "../devices/AddDeviceNameForm";

interface RotateTokenDialogProps {
  device: DeviceSummary;
  open: boolean;
  onClose: () => void;
}

/**
 * Replaces the device's access token (lost token, a phone that changed hands,
 * or another app on the phone) and shows the setup for the new one. Choosing
 * another app keeps the device's history; from then on Trail takes uploads
 * from that app only.
 */
export function RotateTokenDialog({ device, open, onClose }: RotateTokenDialogProps) {
  const rotate = useRotateDeviceToken(device.id);
  const [app, setApp] = useState<DeviceApp>(device.source);
  const [issued, setIssued] = useState<{
    response: DeviceWithCredentialsResponse;
    lastSeenAt: string | null;
  } | null>(null);
  const close = () => {
    onClose();
    setIssued(null);
    setApp(device.source);
    rotate.reset();
  };
  const current = deviceAppInfo[device.source].name;
  return (
    <Dialog
      open={open}
      onClose={close}
      title={issued === null ? "Issue a new access token?" : `New token for ${device.name}`}
      size={issued === null ? "m" : "l"}
      dismissible={!rotate.isPending}
    >
      {issued === null ? (
        <>
          <Notice tone="warning" title="The current token stops working immediately">
            <p>
              {device.name} can only send again once {deviceAppInfo[app].name} has the new token.
              Most apps keep their unsent points and deliver them after that.
            </p>
          </Notice>
          <ChoiceList
            legend="App on the phone"
            hint={`Now ${current}. Another app keeps the device’s history; Overland’s settings presets stay with Overland.`}
            value={app}
            options={appChoices}
            onChange={setApp}
          />
          {app === device.source ? null : (
            <Notice
              tone="info"
              title={`From now on Trail takes uploads from ${deviceAppInfo[app].name} only`}
            >
              <p>{current} gets an error for anything it still sends with the old token.</p>
            </Notice>
          )}
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
                rotate.mutate(app === device.source ? {} : { source: app }, {
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
                app={issued.response.device.source}
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
