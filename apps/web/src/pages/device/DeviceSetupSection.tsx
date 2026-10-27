import type { DeviceSummary } from "@trail/contracts/device";
import { deviceAppInfo, type PhonePlatform, platformsLabel } from "@trail/contracts/deviceApp";
import { trackerIdFor } from "@trail/contracts/owntracksSetup";
import { type ReactNode, useId, useState } from "react";
import { RecommendedSettings } from "../../devices/RecommendedSettings";
import { platformOptions } from "../../devices/setup/OwnTracksCredentials";
import { useConfig } from "../../queries/useConfig";
import { SegmentedControl } from "../../ui/SegmentedControl";

interface DeviceSetupSectionProps {
  device: DeviceSummary;
}

/** The connection as the app on the phone has it, without the token (shown once, when it was issued). */
function ConnectionFacts({ device }: DeviceSetupSectionProps) {
  const config = useConfig();
  const urls = config.data?.ingestUrls;
  const token = <span className="mono">the access token (…{device.tokenHint})</span>;
  const fact = (label: string, value: ReactNode) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  const url = (value: string | undefined) => <span className="mono">{value ?? "—"}</span>;
  switch (device.source) {
    case "overland":
      return (
        <dl className="facts card">
          {fact("Receiver endpoint", url(urls?.overland))}
          {fact("Access token", token)}
          {fact("Device ID", <span className="mono">{device.deviceKey}</span>)}
        </dl>
      );
    case "owntracks":
      return (
        <dl className="facts card">
          {fact("Mode", "HTTP")}
          {fact("URL", url(urls?.owntracks))}
          {fact("Username", <span className="mono">{device.deviceKey}</span>)}
          {fact("Password", token)}
          {fact("Device ID", <span className="mono">{device.deviceKey}</span>)}
          {fact("Tracker ID", <span className="mono">{trackerIdFor(device.name)}</span>)}
        </dl>
      );
    case "traccar":
      return (
        <dl className="facts card">
          {fact("Server URL", url(urls?.osmand))}
          {fact("Device identifier", token)}
        </dl>
      );
    case "osmand":
      return (
        <dl className="facts card">
          {fact("Web address", <>{url(urls?.osmand)}, with the token and OsmAnd’s placeholders</>)}
        </dl>
      );
    case "gpslogger":
      return (
        <dl className="facts card">
          {fact("Custom URL", <>{url(urls?.osmand)}, with GPSLogger’s placeholders</>)}
          {fact("HTTP Headers", <>Authorization: Bearer {token}</>)}
        </dl>
      );
  }
}

/** Which app the device records with, how it is connected and the settings Trail recommends for it. */
export function DeviceSetupSection({ device }: DeviceSetupSectionProps) {
  const headingId = useId();
  const [platform, setPlatform] = useState<PhonePlatform>("ios");
  const app = deviceAppInfo[device.source];
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Setup
        </h2>
        <p className="section__description">
          {app.name} ({platformsLabel(app.platforms)}). To set the phone up again, or with another
          app, issue a new token below: Trail shows the token only when it issues one.
        </p>
      </div>
      <ConnectionFacts device={device} />
      {device.source === "owntracks" ? (
        <SegmentedControl
          label="The phone"
          value={platform}
          options={platformOptions}
          onChange={setPlatform}
        />
      ) : null}
      <RecommendedSettings app={device.source} platform={platform} />
    </section>
  );
}
