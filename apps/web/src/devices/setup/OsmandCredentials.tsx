import type { DeviceCredentials } from "@trail/contracts/device";
import type { ReactNode } from "react";
import { CopyField } from "../../ui/CopyField";
import { RecommendedSettings } from "../RecommendedSettings";
import { TokenOnceNotice } from "./TokenOnceNotice";

interface OsmandCredentialsProps {
  credentials: Extract<DeviceCredentials, { app: "osmand" }>;
  status: ReactNode;
}

/** OsmAnd's online tracking: one web address with its placeholders, the token included. */
export function OsmandCredentials({ credentials, status }: OsmandCredentialsProps) {
  return (
    <>
      <ol className="credentials__steps">
        <li>
          In OsmAnd, turn on the <strong>Trip recording</strong> plugin (Menu › Plugins).
        </li>
        <li>
          In its settings, turn on <strong>Online tracking</strong> and paste the web address below
          as its <strong>Web address</strong>.
        </li>
        <li>
          Start recording a trip: OsmAnd sends points only while it records, and it has no online
          tracking on iPhones.
        </li>
      </ol>
      {status}
      <TokenOnceNotice where="copy the web address" />
      <div className="credentials__values">
        <CopyField
          label="Web address"
          value={credentials.urlTemplate}
          hint="OsmAnd fills in the numbers in braces: position, time, accuracy, altitude, speed, bearing and battery."
        />
      </div>
      <RecommendedSettings app="osmand" />
    </>
  );
}
