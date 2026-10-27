import type { DeviceCredentials } from "@trail/contracts/device";
import type { PhonePlatform } from "@trail/contracts/deviceApp";
import { type ReactNode, useState } from "react";
import { CopyField } from "../../ui/CopyField";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { RecommendedSettings } from "../RecommendedSettings";
import { SetupCode } from "./SetupCode";
import { TokenOnceNotice } from "./TokenOnceNotice";

interface OwnTracksCredentialsProps {
  deviceName: string;
  credentials: Extract<DeviceCredentials, { app: "owntracks" }>;
  status: ReactNode;
}

export const platformOptions = [
  { value: "ios", label: "iPhone" },
  { value: "android", label: "Android" },
] as const satisfies readonly { value: PhonePlatform; label: string }[];

/** Where OwnTracks lets a link change its settings: off until the person allows it. */
function AllowExternalConfiguration({ platform }: { platform: PhonePlatform }) {
  return platform === "ios" ? (
    <p className="credentials__step">
      <strong>First, in OwnTracks:</strong> Settings › <em>Allow external configuration</em> on.
    </p>
  ) : (
    <p className="credentials__step">
      <strong>First, in OwnTracks 2.6 or later:</strong> Preferences › Remote Control ›{" "}
      <em>Allow external configuration</em> on. If the camera does not offer to open the code, open
      this page on the phone and tap the button.
    </p>
  );
}

/**
 * OwnTracks in HTTP mode: a configuration link per platform (the apps read the
 * same tracking keys differently), and the values for setting it up by hand.
 */
export function OwnTracksCredentials({
  deviceName,
  credentials,
  status,
}: OwnTracksCredentialsProps) {
  const [platform, setPlatform] = useState<PhonePlatform>("ios");
  return (
    <>
      <SegmentedControl
        label="The phone"
        value={platform}
        options={platformOptions}
        onChange={setPlatform}
      />
      <SetupCode
        url={credentials.setupUrls[platform]}
        appName="OwnTracks"
        deviceName={deviceName}
        phone={platform === "ios" ? "iPhone" : "phone"}
        fills="HTTP mode, the URL, the password and Trail’s tracking settings"
        first={<AllowExternalConfiguration platform={platform} />}
      />
      {status}
      <TokenOnceNotice where="open the link" />
      <div className="credentials__values">
        <p className="credentials__hint">
          By hand: in OwnTracks’ connection settings choose the mode <strong>HTTP</strong>, turn
          authentication on and enter these.
        </p>
        <CopyField label="URL" value={credentials.endpoint} />
        <CopyField
          label="Username"
          value={credentials.username}
          hint="Any name works: Trail reads only the password."
        />
        <CopyField label="Password (access token)" value={credentials.accessToken} />
        <CopyField label="Device ID" value={credentials.deviceId} />
        <CopyField label="Tracker ID" value={credentials.trackerId} />
      </div>
      <RecommendedSettings app="owntracks" platform={platform} />
    </>
  );
}
