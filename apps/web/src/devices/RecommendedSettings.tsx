import type { DeviceApp } from "@trail/contracts/deviceApp";
import type { OwnTracksProfile } from "@trail/contracts/owntracksSetup";
import { useId } from "react";
import { recommendedSettings } from "./setup/recommendedSettings";
import "./RecommendedSettings.css";

interface RecommendedSettingsProps {
  app: DeviceApp;
  /** OwnTracks reads its settings differently on each platform, and an iPhone can track two ways. */
  owntracksProfile?: OwnTracksProfile;
  /** Its heading's level: under the setup's in a dialog (h3), or of a page's own part (h2). */
  titleAs?: "h2" | "h3";
}

/** The settings Trail recommends for the device's app, for people who set the app up by hand. */
export function RecommendedSettings({
  app,
  owntracksProfile,
  titleAs = "h3",
}: RecommendedSettingsProps) {
  const headingId = useId();
  const list = recommendedSettings(app, owntracksProfile);
  const Title = titleAs;
  return (
    <section className="recommended" aria-labelledby={headingId}>
      <Title className="recommended__title" id={headingId}>
        {list.title}
      </Title>
      <p className="recommended__intro">{list.intro}</p>
      <dl className="recommended__list">
        {list.settings.map((setting) => (
          <div key={setting.name} className="recommended__item">
            <dt>{setting.name}</dt>
            <dd>
              <strong>{setting.value}</strong>
              {setting.why === undefined ? null : <span className="muted"> — {setting.why}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
