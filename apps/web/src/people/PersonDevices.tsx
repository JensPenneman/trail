import type { Person } from "@trail/contracts/person";
import { tripModeLabel } from "../devices/tripModeLabel";
import { capitalise } from "../format/capitalise";
import { useFormatter } from "../format/useFormatter";
import { BatteryIndicator } from "../ui/BatteryIndicator";
import { PlainList } from "../ui/PlainList";
import { RelativeTime } from "../ui/RelativeTime";
import { describeActivity } from "./describeActivity";
import "./PersonDetails.css";

interface PersonDevicesProps {
  person: Person;
  now: number;
  liveMinutes: number;
}

/**
 * Each device someone shares, as their share shows it: updated, what it is
 * doing, battery, accuracy, trip and distance. What the share leaves out is
 * "Not shared"; what there is just nothing recent of is a dash.
 */
export function PersonDevices({ person, now, liveMinutes }: PersonDevicesProps) {
  const format = useFormatter();
  const withheld = person.share.includeDetails ? "—" : "Not shared";
  if (person.devices.length === 0) {
    return <p className="muted">{person.displayName} shares no device with you right now.</p>;
  }
  return (
    <PlainList className="person-details__devices">
      {person.devices.map((device) => {
        const location = device.location;
        const live =
          location !== null && now - Date.parse(location.recordedAt) <= liveMinutes * 60_000;
        return (
          <li key={device.id} className="person-details__device">
            <p className="person-details__device-name">{device.name}</p>
            <dl className="person-details__facts">
              <div>
                <dt>Updated</dt>
                <dd>
                  {location === null ? (
                    "No recent location"
                  ) : (
                    <RelativeTime value={location.recordedAt} tickMs={15_000} />
                  )}
                </dd>
              </div>
              <div>
                <dt>Doing</dt>
                <dd>{describeActivity(location, device.activity, format, { live }) ?? "—"}</dd>
              </div>
              <div>
                <dt>Battery</dt>
                <dd>
                  {device.battery === null ? (
                    withheld
                  ) : (
                    <BatteryIndicator battery={device.battery} />
                  )}
                </dd>
              </div>
              <div>
                <dt>Accuracy</dt>
                <dd>{location?.accuracy == null ? "—" : format.accuracy(location.accuracy)}</dd>
              </div>
              <div>
                <dt>Trip</dt>
                <dd>
                  {device.activity === null
                    ? withheld
                    : device.activity.tripMode === null
                      ? "None in progress"
                      : capitalise(tripModeLabel(device.activity.tripMode))}
                </dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd>{device.distanceM === null ? "—" : format.distance(device.distanceM)}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </PlainList>
  );
}
