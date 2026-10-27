import type { DeviceCredentials } from "@trail/contracts/device";
import type { ReactNode } from "react";
import { GpsLoggerCredentials } from "./setup/GpsLoggerCredentials";
import { OsmandCredentials } from "./setup/OsmandCredentials";
import { OverlandCredentials } from "./setup/OverlandCredentials";
import { OwnTracksCredentials } from "./setup/OwnTracksCredentials";
import { TraccarCredentials } from "./setup/TraccarCredentials";
import "./CredentialsView.css";

interface CredentialsViewProps {
  deviceName: string;
  credentials: DeviceCredentials;
  /** Shown right below the setup code: whether the phone has checked in yet. */
  status: ReactNode;
}

/**
 * What the phone needs, for the device's app (docs/trackers.md): a setup link
 * and QR code where the app takes one, the plain values with copy buttons, and
 * the settings Trail recommends.
 */
export function CredentialsView({ deviceName, credentials, status }: CredentialsViewProps) {
  return (
    <div className="credentials">
      {credentials.app === "overland" ? (
        <OverlandCredentials deviceName={deviceName} credentials={credentials} status={status} />
      ) : credentials.app === "owntracks" ? (
        <OwnTracksCredentials deviceName={deviceName} credentials={credentials} status={status} />
      ) : credentials.app === "traccar" ? (
        <TraccarCredentials deviceName={deviceName} credentials={credentials} status={status} />
      ) : credentials.app === "osmand" ? (
        <OsmandCredentials credentials={credentials} status={status} />
      ) : (
        <GpsLoggerCredentials credentials={credentials} status={status} />
      )}
    </div>
  );
}
