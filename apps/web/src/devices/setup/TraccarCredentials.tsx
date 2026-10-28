import type { DeviceCredentials } from "@trail/contracts/device";
import type { ReactNode } from "react";
import { CopyField } from "../../ui/CopyField";
import { Notice } from "../../ui/Notice";
import { RecommendedSettings } from "../RecommendedSettings";
import { SetupCode } from "./SetupCode";
import { TokenOnceNotice } from "./TokenOnceNotice";

interface TraccarCredentialsProps {
  deviceName: string;
  credentials: Extract<DeviceCredentials, { app: "traccar" }>;
  status: ReactNode;
}

/**
 * Traccar Client: its configuration link (which its own QR scanner reads as
 * well), and the two values — the device identifier is the token.
 */
export function TraccarCredentials({ deviceName, credentials, status }: TraccarCredentialsProps) {
  return (
    <>
      <SetupCode
        url={credentials.setupUrl}
        appName="Traccar Client"
        deviceName={deviceName}
        phone="phone"
        fills="the server URL, the device identifier and Trail’s tracking settings"
        first={
          <p className="credentials__hint">
            Traccar Client asks “Apply new configuration?”: tap OK. Its own scanner (Settings, the
            code icon) reads the code too.
          </p>
        }
      />
      {status}
      <TokenOnceNotice where="scan the code" />
      <div className="credentials__values">
        <CopyField label="Server URL" value={credentials.endpoint} />
        <CopyField
          label="Device identifier (access token)"
          value={credentials.accessToken}
          hint="Traccar Client sends nothing else to identify the phone, so the identifier is the token."
        />
      </div>
      <Notice tone="info" title="Traccar Client shows the identifier on its main screen">
        <p>It is the device’s token: keep screenshots of the app to yourself.</p>
      </Notice>
      <RecommendedSettings app="traccar" />
    </>
  );
}
