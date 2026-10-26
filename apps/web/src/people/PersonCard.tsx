import type { Person, SharedDevice } from "@trail/contracts/person";
import { useId } from "react";
import { useFormatter } from "../format/useFormatter";
import { expiryText, historyText, precisionInfo } from "../sharing/shareText";
import { BatteryIndicator } from "../ui/BatteryIndicator";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { PlainList } from "../ui/PlainList";
import { RelativeTime } from "../ui/RelativeTime";
import { describeActivity } from "./describeActivity";
import { appleMapsUrl, googleMapsUrl } from "./mapLinks";
import { PersonAvatar } from "./PersonAvatar";
import { primaryDevice } from "./primaryDevice";
import "./PersonCard.css";

interface PersonCardProps {
  person: Person;
  colorSlot: number;
  now: number;
  /** Positions younger than this count as live (the server's live window). */
  liveMinutes: number;
  /** Whether the signed-in person shares back with them. */
  sharesBack: boolean;
  onShowOnMap: (device: SharedDevice) => void;
  onShareBack: () => void;
  onHide: () => void;
  hiding?: boolean;
}

/**
 * Someone who shares their location, Find My style: who, where and how fresh,
 * what they are doing, battery and distance — everything the map shows, in
 * text — and what to do: show them on the map, open the spot in Apple or
 * Google Maps, share back, hide them.
 */
export function PersonCard({
  person,
  colorSlot,
  now,
  liveMinutes,
  sharesBack,
  onShowOnMap,
  onShareBack,
  onHide,
  hiding = false,
}: PersonCardProps) {
  const format = useFormatter();
  const titleId = useId();
  const primary = primaryDevice(person.devices);
  const where = primary?.location ?? null;
  const live = where !== null && now - Date.parse(where.recordedAt) <= liveMinutes * 60_000;
  const precision = person.share.precision;

  return (
    <article className="person-card" aria-labelledby={titleId}>
      <header className="person-card__header">
        <PersonAvatar name={person.displayName} slot={colorSlot} />
        <div className="person-card__heading">
          <h3 className="person-card__name" id={titleId}>
            {person.displayName}
          </h3>
          <p className="person-card__freshness">
            {where === null ? (
              "No recent location"
            ) : (
              <>
                {live ? <span className="person-card__live">Live</span> : null}
                Updated <RelativeTime value={where.recordedAt} tickMs={15_000} />
              </>
            )}
          </p>
        </div>
        {primary?.distanceM === null || primary?.distanceM === undefined ? null : (
          <p className="person-card__distance">
            <span className="visually-hidden">Distance from you: </span>
            {format.distance(primary.distanceM)}
          </p>
        )}
      </header>

      {precision === "precise" ? null : (
        <p className="person-card__precision">
          <Icon name="target" />
          <span>{precisionInfo[precision].short}</span>
        </p>
      )}

      {person.devices.length === 0 ? (
        <p className="muted">{person.displayName} shares no device with you right now.</p>
      ) : (
        <PlainList className="person-card__devices">
          {person.devices.map((device) => (
            <li key={device.id} className="person-card__device">
              <p className="person-card__device-name">{device.name}</p>
              <dl className="person-card__facts">
                <div>
                  <dt>Doing</dt>
                  <dd>{describeActivity(device.location, device.activity, format) ?? "—"}</dd>
                </div>
                <div>
                  <dt>Battery</dt>
                  <dd>
                    {device.battery === null ? (
                      "Not shared"
                    ) : (
                      <BatteryIndicator battery={device.battery} />
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>
                    {device.location === null ? (
                      "—"
                    ) : (
                      <RelativeTime value={device.location.recordedAt} tickMs={15_000} />
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Distance</dt>
                  <dd>{device.distanceM === null ? "—" : format.distance(device.distanceM)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </PlainList>
      )}

      <p className="person-card__share">
        {historyText(person.share.historyDays)} ·{" "}
        {person.share.expiresAt === null
          ? "No end set"
          : expiryText(person.share.expiresAt, format, now)}
      </p>

      <div className="person-card__actions">
        <Button
          icon="pin"
          disabled={primary === null || where === null}
          onClick={() => {
            if (primary !== null) onShowOnMap(primary);
          }}
        >
          Show on map
        </Button>
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
          <p className="person-card__back">
            <Icon name="check" /> You share with {person.displayName}
          </p>
        ) : (
          <Button icon="users" onClick={onShareBack}>
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
    </article>
  );
}
