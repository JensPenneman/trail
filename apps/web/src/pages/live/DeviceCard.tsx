import type { DeviceSummary } from "@trail/contracts/device";
import type { DeviceStatus } from "@trail/contracts/deviceStatus";
import { useId } from "react";
import { Link } from "react-router";
import { describeMovement } from "../../devices/describeMovement";
import { tripModeLabel } from "../../devices/tripModeLabel";
import { useFormatter } from "../../format/useFormatter";
import { BatteryIndicator } from "../../ui/BatteryIndicator";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { Icon } from "../../ui/Icon";
import { RelativeTime } from "../../ui/RelativeTime";
import { StatusBadge } from "../../ui/StatusBadge";
import { ActivitySparkline } from "./ActivitySparkline";
import type { ActivitySlot } from "./activitySlots";
import "./DeviceCard.css";

interface DeviceCardProps {
  device: DeviceSummary;
  status: DeviceStatus;
  thresholds: { liveMinutes: number; staleHours: number };
  colorSlot: number;
  /** Jitter-filtered distance today, from today's track (null while it loads). */
  distanceTodayM: number | null;
  activity: readonly ActivitySlot[] | null;
  now: number;
}

/** Everything that proves a device is (or is not) sending data, in text — the map shows the same. */
export function DeviceCard({
  device,
  status,
  thresholds,
  colorSlot,
  distanceTodayM,
  activity,
  now,
}: DeviceCardProps) {
  const format = useFormatter();
  const titleId = useId();
  const location = device.lastLocation;
  const movement = describeMovement(location, format);
  // What a silent or idle device last reported is history, not its current state.
  const movementText =
    movement === null ? "—" : status === "live" ? movement : `Last seen ${movement.toLowerCase()}`;
  const trip = device.liveTrip;

  return (
    <article className={`device-card device-card--${status}`} aria-labelledby={titleId}>
      <header className="device-card__header">
        <DeviceSwatch slot={colorSlot} />
        <h3 className="device-card__name" id={titleId}>
          <Link to={`/devices/${device.id}`}>{device.name}</Link>
        </h3>
        <StatusBadge status={status} thresholds={thresholds} />
      </header>

      {device.lastSeenAt === null ? (
        <p className="device-card__upload device-card__upload--never">
          Waiting for the first upload. Open Overland on the phone and check that tracking is on.{" "}
          <Link to={`/devices/${device.id}`}>Setup details</Link>
        </p>
      ) : (
        <p className="device-card__upload">
          <span className="muted">Last upload</span>{" "}
          <strong>
            <RelativeTime value={device.lastSeenAt} />
          </strong>
        </p>
      )}

      {trip === null ? null : (
        <p className="device-card__trip">
          <Icon name="route" />
          <span>
            <strong>Trip in progress</strong> · {tripModeLabel(trip.mode)} ·{" "}
            {format.distance(trip.distanceM)} ·{" "}
            {format.duration((now - Date.parse(trip.startedAt)) / 1000)}
          </span>
        </p>
      )}

      <dl className="device-card__facts">
        <div>
          <dt>Battery</dt>
          <dd>
            <BatteryIndicator battery={device.battery} />
          </dd>
        </div>
        <div>
          <dt>Movement</dt>
          <dd>{movementText}</dd>
        </div>
        <div>
          <dt>Points today</dt>
          <dd>{format.count(device.counts.today)}</dd>
        </div>
        <div>
          <dt>Distance today</dt>
          <dd>{distanceTodayM === null ? "…" : format.distance(distanceTodayM)}</dd>
        </div>
        <div className="device-card__wide">
          <dt>Last position</dt>
          <dd>
            {location === null ? (
              "—"
            ) : (
              <>
                {format.coordinates(location.lat, location.lon)}
                <span className="muted">
                  {location.accuracy === null ? "" : ` ${format.accuracy(location.accuracy)}`} ·{" "}
                  {format.time(location.recordedAt)}
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>

      {activity === null ? null : (
        <ActivitySparkline slots={activity} colorSlot={colorSlot} deviceName={device.name} />
      )}
    </article>
  );
}
