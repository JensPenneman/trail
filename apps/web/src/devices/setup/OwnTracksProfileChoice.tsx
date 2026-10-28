import type { PhonePlatform } from "@trail/contracts/deviceApp";
import { type OwnTracksProfile, platformOfProfile } from "@trail/contracts/owntracksSetup";
import { useState } from "react";
import { SegmentedControl } from "../../ui/SegmentedControl";

type IphoneTracking = "move" | "significant";

const platformOptions = [
  { value: "ios", label: "iPhone" },
  { value: "android", label: "Android" },
] as const satisfies readonly { value: PhonePlatform; label: string }[];

const trackingOptions = [
  { value: "move", label: "Move" },
  { value: "significant", label: "Significant changes" },
] as const satisfies readonly { value: IphoneTracking; label: string }[];

/** What each way of tracking on an iPhone costs, said where the person chooses it. */
const trackingNotes: Record<IphoneTracking, string> = {
  move: "Move keeps GPS on while OwnTracks tracks, for a point every 30 m: the detail Trail needs to tell walking from cycling from driving, at a high battery cost — expect the battery to run down noticeably faster.",
  significant:
    "Significant changes leaves the fixes to iOS: a point every few hundred metres or every few minutes, for very little battery — enough for where you were, not for how you travelled.",
};

const profileOf = (platform: PhonePlatform, tracking: IphoneTracking): OwnTracksProfile => {
  if (platform === "android") return "android";
  return tracking === "move" ? "ios" : "iosSignificant";
};

interface OwnTracksProfileChoiceProps {
  value: OwnTracksProfile;
  onChange: (profile: OwnTracksProfile) => void;
}

/**
 * The phone OwnTracks runs on — the apps read the same settings differently —
 * and on an iPhone how it tracks: Move, Trail's default, or Significant
 * changes, with what each costs in battery.
 */
export function OwnTracksProfileChoice({ value, onChange }: OwnTracksProfileChoiceProps) {
  const platform = platformOfProfile(value);
  const [tracking, setTracking] = useState<IphoneTracking>(
    value === "iosSignificant" ? "significant" : "move",
  );
  return (
    <>
      <SegmentedControl
        label="The phone"
        value={platform}
        options={platformOptions}
        onChange={(next) => onChange(profileOf(next, tracking))}
      />
      {platform === "ios" ? (
        <>
          <SegmentedControl
            label="Tracking on the iPhone"
            value={tracking}
            options={trackingOptions}
            onChange={(next) => {
              setTracking(next);
              onChange(profileOf("ios", next));
            }}
          />
          <p className="credentials__hint">{trackingNotes[tracking]}</p>
        </>
      ) : null}
    </>
  );
}
