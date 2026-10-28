import type { DeviceCredentials } from "@trail/contracts/device";
import type { ReactNode } from "react";
import { CopyField } from "../../ui/CopyField";
import { RecommendedSettings } from "../RecommendedSettings";
import { TokenOnceNotice } from "./TokenOnceNotice";

interface GpsLoggerCredentialsProps {
  credentials: Extract<DeviceCredentials, { app: "gpslogger" }>;
  status: ReactNode;
}

/** GPSLogger's custom URL: the URL with its placeholders, and the token in a header. */
export function GpsLoggerCredentials({ credentials, status }: GpsLoggerCredentialsProps) {
  return (
    <>
      <ol className="credentials__steps">
        <li>
          In GPSLogger, open <strong>Logging details › Log to custom URL</strong> and turn it on.
        </li>
        <li>Enter the URL, the HTTP header and the method below; leave the body empty.</li>
        <li>Start logging.</li>
      </ol>
      {status}
      <TokenOnceNotice where="copy the header" />
      <div className="credentials__values">
        <CopyField
          label="URL"
          value={credentials.url}
          hint="GPSLogger fills in the %-placeholders: position, time, accuracy, altitude, speed, bearing and battery."
        />
        <CopyField label="HTTP Headers" value={credentials.headers} />
        <CopyField label="HTTP Method" value="GET" />
      </div>
      <RecommendedSettings app="gpslogger" />
    </>
  );
}
