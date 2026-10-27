import type { DeviceCredentials } from "@trail/contracts/device";
import type { ReactNode } from "react";
import { CopyField } from "../../ui/CopyField";
import { RecommendedSettings } from "../RecommendedSettings";
import { SetupCode } from "./SetupCode";
import { TokenOnceNotice } from "./TokenOnceNotice";

interface OverlandCredentialsProps {
  deviceName: string;
  credentials: Extract<DeviceCredentials, { app: "overland" }>;
  status: ReactNode;
}

/** Overland's setup link (`overland://setup`) and its three values. */
export function OverlandCredentials({ deviceName, credentials, status }: OverlandCredentialsProps) {
  return (
    <>
      <SetupCode
        url={credentials.setupUrl}
        appName="Overland"
        deviceName={deviceName}
        phone="iPhone"
        fills="the endpoint, token and device ID"
      />
      {status}
      <TokenOnceNotice where="scan the code" />
      <div className="credentials__values">
        <CopyField label="Receiver endpoint" value={credentials.endpoint} />
        <CopyField label="Access token" value={credentials.accessToken} />
        <CopyField label="Device ID" value={credentials.deviceKey} />
      </div>
      <RecommendedSettings app="overland" />
    </>
  );
}
