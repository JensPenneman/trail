import type { Person } from "@trail/contracts/person";
import { tripModeLabel } from "../devices/tripModeLabel";
import { capitalise } from "../format/capitalise";
import { useFormatter } from "../format/useFormatter";
import { expiryText, historyText, precisionInfo } from "../sharing/shareText";
import { BatteryIndicator } from "../ui/BatteryIndicator";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { PlainList } from "../ui/PlainList";
import { RelativeTime } from "../ui/RelativeTime";
import { describeActivity } from "./describeActivity";
import { appleMapsUrl, googleMapsUrl } from "./mapLinks";
import { primaryDevice } from "./primaryDevice";

interface PersonDetailsProps {
  person: Person;
  now: number;
  liveMinutes: number;
  sharesBack: boolean;
  onShareBack: () => void;
  onStopSharing?: () => void;
  onHide: () => void;
  hiding: boolean;
}

/**
 * A person's card, opened up: each device they share as the share shows it
 * (updated, what it is doing, battery, accuracy, trip, distance), what the
 * share includes and until when, and the rest of what can be done — open the
 * spot in Apple or Google Maps, share back or stop, hide them.
 */
export function PersonDetails({
  person,
  now,
  liveMinutes,
  sharesBack,
  onShareBack,
  onStopSharing,
  onHide,
  hiding,
}: PersonDetailsProps) {
  const format = useFormatter();
  const { share } = person;
  const where = primaryDevice(person.devices)?.location ?? null;
  // Missing battery or activity: left out by the share, or nothing recent to tell.
  const withheld = share.includeDetails ? "—" : "Not shared";

  return (
    <div className="person-details">
      <div className="person-details__part">
        <h4 className="person-details__title">
          {person.devices.length === 1 ? "Device" : "Devices"}
        </h4>
        {person.devices.length === 0 ? (
          <p className="muted">{person.displayName} shares no device with you right now.</p>
        ) : (
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
                      <dd>
                        {describeActivity(location, device.activity, format, { live }) ?? "—"}
                      </dd>
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
                      <dd>
                        {location?.accuracy == null ? "—" : format.accuracy(location.accuracy)}
                      </dd>
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
        )}
      </div>

      <div className="person-details__part">
        <h4 className="person-details__title">What {person.displayName} shares</h4>
        <dl className="person-details__facts">
          <div>
            <dt>Precision</dt>
            <dd>{precisionInfo[share.precision].short}</dd>
          </div>
          <div>
            <dt>Where they’ve been</dt>
            <dd>{historyText(share.historyDays)}</dd>
          </div>
          <div>
            <dt>Battery and activity</dt>
            <dd>{share.includeDetails ? "Shared" : "Not shared"}</dd>
          </div>
          <div>
            <dt>Until</dt>
            <dd>
              {share.expiresAt === null ? "No end set" : expiryText(share.expiresAt, format, now)}
            </dd>
          </div>
          <div>
            <dt>Since</dt>
            <dd>{format.dayTime(share.createdAt)}</dd>
          </div>
        </dl>
      </div>

      <div className="person-details__actions">
        {where === null ? null : (
          <>
            <a
              className="button button--ghost"
              href={appleMapsUrl(where.lat, where.lon, person.displayName)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${person.displayName}’s location in Apple Maps (new tab)`}
            >
              <Icon name="external" />
              <span>Apple Maps</span>
            </a>
            <a
              className="button button--ghost"
              href={googleMapsUrl(where.lat, where.lon)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${person.displayName}’s location in Google Maps (new tab)`}
            >
              <Icon name="external" />
              <span>Google Maps</span>
            </a>
          </>
        )}
        {sharesBack ? (
          <>
            <p className="person-details__back">
              <Icon name="check" /> You share with {person.displayName}
            </p>
            {onStopSharing === undefined ? null : (
              <Button
                variant="danger-outline"
                onClick={onStopSharing}
                aria-label={`Stop sharing your location with ${person.displayName}`}
              >
                Stop
              </Button>
            )}
          </>
        ) : (
          <Button
            icon="users"
            onClick={onShareBack}
            aria-label={`Share back with ${person.displayName}`}
          >
            Share back
          </Button>
        )}
        <Button
          variant="ghost"
          icon="close"
          busy={hiding}
          onClick={onHide}
          aria-label={`Hide ${person.displayName}`}
        >
          Hide
        </Button>
      </div>
    </div>
  );
}
