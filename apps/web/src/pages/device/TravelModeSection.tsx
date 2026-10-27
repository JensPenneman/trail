import type { DeviceSummary } from "@trail/contracts/device";
import { useId } from "react";
import { QuickModeChips } from "../../transport/QuickModeChips";

/**
 * The quick toggle for this device: the Me card's applies to the device that
 * reported last, so a second phone (a tracker in the car, an old iPhone) gets
 * its mode set here.
 */
export function TravelModeSection({ device }: { device: DeviceSummary }) {
  const headingId = useId();
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Travelling now
        </h2>
        <p className="section__description">
          How this device travels from now until its next stop; Auto leaves it to Trail.
        </p>
      </div>
      <div className="card">
        <QuickModeChips deviceId={device.id} deviceName={device.name} />
      </div>
    </section>
  );
}
