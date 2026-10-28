import type { DeviceSummary } from "@trail/contracts/device";
import type { PhonePlatform } from "@trail/contracts/deviceApp";
import {
  type OwnTracksProfile,
  platformOfProfile,
  trackerIdFor,
} from "@trail/contracts/owntracksSetup";
import { type ReactNode, useState } from "react";
import { RecommendedSettings } from "../../devices/RecommendedSettings";
import { OwnTracksProfileChoice } from "../../devices/setup/OwnTracksProfileChoice";
import { useConfig } from "../../queries/useConfig";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsFact } from "../../settings/SettingsRow";

interface DeviceSetupSectionProps {
  device: DeviceSummary;
}

/** The connection as the app on the phone has it, without the token (shown once, when it was issued). */
function ConnectionFacts({
  device,
  platform,
}: DeviceSetupSectionProps & { platform: PhonePlatform }) {
  const config = useConfig();
  const urls = config.data?.ingestUrls;
  const token = <span className="mono">the access token (…{device.tokenHint})</span>;
  const fact = (label: string, value: ReactNode) => (
    <SettingsFact key={label} label={label}>
      {value}
    </SettingsFact>
  );
  const url = (value: string | undefined) => <span className="mono">{value ?? "—"}</span>;
  switch (device.source) {
    case "overland":
      return [
        fact("Receiver endpoint", url(urls?.overland)),
        fact("Access token", token),
        fact("Device ID", <span className="mono">{device.deviceKey}</span>),
      ];
    case "owntracks":
      return [
        fact("Mode", "HTTP"),
        fact("URL", url(urls?.owntracks)),
        platform === "ios"
          ? fact("HTTP Headers", <>Authorization: Bearer {token}</>)
          : fact("Password", token),
        fact("Username", <span className="mono">{device.deviceKey}</span>),
        fact("Device ID", <span className="mono">{device.deviceKey}</span>),
        fact("Tracker ID", <span className="mono">{trackerIdFor(device.name)}</span>),
      ];
    case "traccar":
      return [fact("Server URL", url(urls?.osmand)), fact("Device identifier", token)];
    case "osmand":
      return [
        fact("Web address", <>{url(urls?.osmand)}, with the token and OsmAnd’s placeholders</>),
      ];
    case "gpslogger":
      return [
        fact("Custom URL", <>{url(urls?.osmand)}, with GPSLogger’s placeholders</>),
        fact("HTTP Headers", <>Authorization: Bearer {token}</>),
      ];
  }
}

/**
 * How the device's app is connected — for OwnTracks on the phone it runs on —
 * and the settings Trail recommends for it: what to check or set again by
 * hand. The token itself is shown only when Trail issues one.
 */
export function DeviceSetupSection({ device }: DeviceSetupSectionProps) {
  const [profile, setProfile] = useState<OwnTracksProfile>("ios");
  return (
    <>
      {device.source === "owntracks" ? (
        <SettingsGroup title="The phone" variant="card">
          <OwnTracksProfileChoice value={profile} onChange={setProfile} />
        </SettingsGroup>
      ) : null}
      <SettingsGroup title="Connection" variant="facts">
        <ConnectionFacts device={device} platform={platformOfProfile(profile)} />
      </SettingsGroup>
      <SettingsGroup variant="card">
        <RecommendedSettings app={device.source} owntracksProfile={profile} titleAs="h2" />
      </SettingsGroup>
    </>
  );
}
