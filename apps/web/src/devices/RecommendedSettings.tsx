import { useId } from "react";
import "./RecommendedSettings.css";

const settings: readonly { name: string; value: string; why?: string }[] = [
  {
    name: "Logging mode",
    value: "All Data",
    why: "Required: Trail reads Overland’s full batch format.",
  },
  {
    name: "Tracking mode",
    value: "Standard",
    why: "Continuous tracking; the phone decides when to pause.",
  },
  { name: "Desired accuracy", value: "100 m" },
  { name: "Pause updates automatically", value: "On", why: "Saves battery while you stand still." },
  { name: "Resume with geofence", value: "200 m" },
  { name: "Visit tracking", value: "On", why: "Adds the places you stayed to History." },
  { name: "Points per batch", value: "200" },
  { name: "Send interval", value: "5 minutes" },
  { name: "Minimum distance / time", value: "10 m / 5 s" },
];

/** The settings behind Trail's "Balanced" preset, for people who set up Overland by hand. */
export function RecommendedSettings() {
  const headingId = useId();
  return (
    <section className="recommended" aria-labelledby={headingId}>
      <h3 className="recommended__title" id={headingId}>
        Recommended Overland settings
      </h3>
      <p className="recommended__intro">
        The setup code fills in the connection only. These give detailed tracks without draining the
        battery; later you can also send a preset to the phone from the device’s page.
      </p>
      <dl className="recommended__list">
        {settings.map((setting) => (
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
