import type { DeviceSummary } from "@trail/contracts/device";
import { deviceStatus } from "@trail/contracts/deviceStatus";
import { Link } from "react-router";
import { describeMovement } from "../../devices/describeMovement";
import { tripModeLabel } from "../../devices/tripModeLabel";
import { capitalise } from "../../format/capitalise";
import { useFormatter } from "../../format/useFormatter";
import { BatteryIndicator } from "../../ui/BatteryIndicator";
import { Icon } from "../../ui/Icon";
import { PlainList } from "../../ui/PlainList";
import { RelativeTime } from "../../ui/RelativeTime";

interface MyDevicesProps {
  devices: readonly DeviceSummary[];
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
}

/**
 * The Me card, opened up: each of one's devices with when it last reported
 * a position, its battery, accuracy, movement and trip — each linking to its
 * page — and the way to the Devices page, where the uploads are.
 */
export function MyDevices({ devices, now, thresholds }: MyDevicesProps) {
  const format = useFormatter();
  return (
    <div className="person-details">
      <div className="person-details__part">
        <h3 className="person-details__title">Your devices</h3>
        <PlainList className="person-details__devices">
          {devices.map((device) => {
            const location = device.lastLocation;
            const movement = describeMovement(location, format);
            const live = deviceStatus(device.lastSeenAt, new Date(now), thresholds) === "live";
            const trip = device.liveTrip;
            return (
              <li key={device.id} className="person-details__device">
                <p className="person-details__device-name">
                  <Link to={`/devices/${device.id}`}>{device.name}</Link>
                </p>
                <dl className="person-details__facts">
                  <div>
                    <dt>Updated</dt>
                    <dd>
                      {location === null ? (
                        "No position yet"
                      ) : (
                        <RelativeTime value={location.recordedAt} tickMs={15_000} />
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Battery</dt>
                    <dd>
                      <BatteryIndicator battery={device.battery} />
                    </dd>
                  </div>
                  <div>
                    <dt>Accuracy</dt>
                    <dd>{location?.accuracy == null ? "—" : format.accuracy(location.accuracy)}</dd>
                  </div>
                  <div>
                    <dt>{live ? "Movement" : "Last reported movement"}</dt>
                    <dd>{movement ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Trip</dt>
                    <dd>
                      {trip === null
                        ? "None in progress"
                        : `${capitalise(tripModeLabel(trip.mode))} since ${format.time(trip.startedAt)} · ${format.distance(trip.distanceM)}`}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </PlainList>
      </div>
      <Link to="/devices" className="person-details__more">
        <span>Uploads, activity and settings of your devices</span>
        <Icon name="chevronRight" />
      </Link>
    </div>
  );
}
