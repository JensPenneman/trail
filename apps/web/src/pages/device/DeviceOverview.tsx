import type { DeviceSummary } from "@trail/contracts/device";
import { useId } from "react";
import { describeMovement } from "../../devices/describeMovement";
import { tripModeLabel } from "../../devices/tripModeLabel";
import { useFormatter } from "../../format/useFormatter";
import { BatteryIndicator } from "../../ui/BatteryIndicator";
import { RelativeTime } from "../../ui/RelativeTime";

interface DeviceOverviewProps {
  device: DeviceSummary;
  /** Whether the device is live: otherwise its movement is only what it last reported. */
  live: boolean;
}

/** The device's latest state as label/value pairs. */
export function DeviceOverview({ device, live }: DeviceOverviewProps) {
  const format = useFormatter();
  const headingId = useId();
  const location = device.lastLocation;
  const movement = describeMovement(location, format);
  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        Overview
      </h2>
      <dl className="facts card">
        <div>
          <dt>Last upload</dt>
          <dd>
            {device.lastSeenAt === null ? (
              "Never"
            ) : (
              <>
                <RelativeTime value={device.lastSeenAt} />
                <span className="muted"> · {format.dateTime(device.lastSeenAt)}</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Last position</dt>
          <dd>
            {location === null ? (
              "—"
            ) : (
              <>
                {format.coordinates(location.lat, location.lon)}
                <span className="muted">
                  {location.accuracy === null ? "" : ` ${format.accuracy(location.accuracy)}`} ·{" "}
                  {format.dateTime(location.recordedAt)}
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{live ? "Movement" : "Last reported movement"}</dt>
          <dd>{movement ?? "—"}</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd>{location?.altitude == null ? "—" : format.metres(location.altitude)}</dd>
        </div>
        <div>
          <dt>Battery</dt>
          <dd>
            <BatteryIndicator battery={device.battery} />
          </dd>
        </div>
        <div>
          <dt>Trip</dt>
          <dd>
            {device.liveTrip === null
              ? "None in progress"
              : `${tripModeLabel(device.liveTrip.mode)} since ${format.time(device.liveTrip.startedAt)} · ${format.distance(device.liveTrip.distanceM)}`}
          </dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>
            {format.count(device.counts.today)} today · {format.count(device.counts.last24h)} in 24
            h · {format.count(device.counts.total)} in total
          </dd>
        </div>
        <div>
          <dt>Device ID</dt>
          <dd className="mono">{device.deviceKey}</dd>
        </div>
        <div>
          <dt>Access token</dt>
          <dd>
            <span className="mono">…{device.tokenHint}</span>
          </dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{format.dateTime(device.createdAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
