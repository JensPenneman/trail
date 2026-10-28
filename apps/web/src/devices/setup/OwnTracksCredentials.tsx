import type { DeviceCredentials } from "@trail/contracts/device";
import type { PhonePlatform } from "@trail/contracts/deviceApp";
import { type OwnTracksProfile, platformOfProfile } from "@trail/contracts/owntracksSetup";
import { type ReactNode, useState } from "react";
import { CopyField } from "../../ui/CopyField";
import { RecommendedSettings } from "../RecommendedSettings";
import { OwnTracksProfileChoice } from "./OwnTracksProfileChoice";
import { SetupCode } from "./SetupCode";
import { TokenOnceNotice } from "./TokenOnceNotice";

interface OwnTracksCredentialsProps {
  deviceName: string;
  credentials: Extract<DeviceCredentials, { app: "owntracks" }>;
  status: ReactNode;
}

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
 * same tracking keys differently; an iPhone can trade detail for battery), and
 * the values for setting it up by hand — the token as an iPhone's bearer
 * header, as Android's password.
 */
export function OwnTracksCredentials({
  deviceName,
  credentials,
  status,
}: OwnTracksCredentialsProps) {
  const [profile, setProfile] = useState<OwnTracksProfile>("ios");
  const platform = platformOfProfile(profile);
  return (
    <>
      <OwnTracksProfileChoice value={profile} onChange={setProfile} />
      <SetupCode
        url={credentials.setupUrls[profile]}
        appName="OwnTracks"
        deviceName={deviceName}
        phone={platform === "ios" ? "iPhone" : "phone"}
        fills="HTTP mode, the URL, the access token and Trail’s tracking settings"
        first={<AllowExternalConfiguration platform={platform} />}
      />
      {status}
      <TokenOnceNotice where="open the link" />
      <div className="credentials__values">
        {platform === "ios" ? (
          <p className="credentials__hint">
            By hand: in OwnTracks’ settings choose the mode <strong>HTTP</strong>, leave{" "}
            <em>Authentication</em> off and enter these.
          </p>
        ) : (
          <p className="credentials__hint">
            By hand: in OwnTracks’ connection settings choose the mode <strong>HTTP</strong>, turn
            authentication on and enter these.
          </p>
        )}
        <CopyField label="URL" value={credentials.endpoint} />
        {platform === "ios" ? (
          <CopyField
            label="HTTP Headers (access token)"
            value={`Authorization: Bearer ${credentials.accessToken}`}
            hint="OwnTracks adds this header to every upload."
          />
        ) : null}
        <CopyField
          label="Username"
          value={credentials.username}
          hint="Any name works: Trail reads only the access token."
        />
        {platform === "android" ? (
          <CopyField label="Password (access token)" value={credentials.accessToken} />
        ) : null}
        <CopyField label="Device ID" value={credentials.deviceId} />
        <CopyField label="Tracker ID" value={credentials.trackerId} />
      </div>
      <RecommendedSettings app="owntracks" owntracksProfile={profile} />
    </>
  );
}
