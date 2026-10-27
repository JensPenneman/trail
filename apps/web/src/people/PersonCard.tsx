import type { Person, SharedDevice } from "@trail/contracts/person";
import { useId } from "react";
import { useFormatter } from "../format/useFormatter";
import { precisionInfo } from "../sharing/shareText";
import { BatteryIndicator } from "../ui/BatteryIndicator";
import { Button } from "../ui/Button";
import { DisclosureButton } from "../ui/DisclosureButton";
import { DisclosureContent } from "../ui/DisclosureContent";
import { useDisclosure } from "../ui/useDisclosure";
import { describeActivity } from "./describeActivity";
import { PersonDetails } from "./PersonDetails";
import { PersonSummary } from "./PersonSummary";
import type { PersonTrackState } from "./PersonTrackState";
import { primaryDevice } from "./primaryDevice";
import { WhereTheyveBeen, type WhereTheyveBeenPeriod } from "./WhereTheyveBeen";
import "./PersonCard.css";

interface PersonCardProps {
  person: Person;
  colorSlot: number;
  now: number;
  /** Positions younger than this count as live (the server's live window). */
  liveMinutes: number;
  /** Whether the signed-in person shares back with them. */
  sharesBack: boolean;
  /** Whether the map shows them now (the People page's selection). */
  selected?: boolean;
  /** Where they have been, while the map shows them in a view with tracks. */
  where?: { period: WhereTheyveBeenPeriod; track: PersonTrackState | null } | undefined;
  onShowOnMap: (device: SharedDevice) => void;
  onShareBack: () => void;
  /** Stops sharing back with them (with a confirmation); offered while one does. */
  onStopSharing?: () => void;
  onHide: () => void;
  hiding?: boolean;
}

/**
 * Someone who shares their location, Find My style: in two lines who they
 * are and how far, what they are doing and how fresh that is, and a battery
 * glyph when the share includes it; Show on map; and Details, closed at
 * first, with everything else — each device, what the share includes, the
 * links to Apple and Google Maps, sharing back (or stopping) and hiding.
 * While they are on the map the card also says where they have been.
 */
export function PersonCard({
  person,
  colorSlot,
  now,
  liveMinutes,
  sharesBack,
  selected = false,
  where,
  onShowOnMap,
  onShareBack,
  onStopSharing,
  onHide,
  hiding = false,
}: PersonCardProps) {
  const format = useFormatter();
  const titleId = useId();
  const details = useDisclosure();
  const primary = primaryDevice(person.devices);
  const location = primary?.location ?? null;
  const live = location !== null && now - Date.parse(location.recordedAt) <= liveMinutes * 60_000;
  // A coarse position says how coarse when nothing else can be said of it.
  const doing =
    person.devices.length === 0
      ? "Shares no device right now"
      : location === null
        ? "No recent location"
        : (describeActivity(location, primary?.activity ?? null, format, { live }) ??
          precisionInfo[person.share.precision].within);

  return (
    <article
      className={selected ? "person-card person-card--selected" : "person-card"}
      aria-labelledby={titleId}
    >
      <PersonSummary
        title={person.displayName}
        titleId={titleId}
        level={3}
        avatar={{ name: person.displayName, slot: colorSlot }}
        freshness={location === null ? null : { recordedAt: location.recordedAt, live }}
        doing={doing}
        {...(primary?.distanceM === null || primary?.distanceM === undefined
          ? {}
          : {
              distance: (
                <>
                  <span className="visually-hidden">Distance from you: </span>
                  {format.distance(primary.distanceM)}
                </>
              ),
            })}
        {...(person.share.includeDetails && primary?.battery != null
          ? {
              battery: (
                <>
                  <span className="visually-hidden">Battery: </span>
                  <BatteryIndicator battery={primary.battery} />
                </>
              ),
            }
          : {})}
        onMap={selected}
      />

      {selected && where !== undefined ? (
        <WhereTheyveBeen
          person={person}
          period={where.period}
          track={where.track}
          titleId={titleId}
        />
      ) : null}

      <div className="person-card__actions">
        {/* Every card has these: the name, as a description, says whose. */}
        <Button
          icon="pin"
          aria-describedby={titleId}
          disabled={primary === null || location === null}
          onClick={() => {
            if (primary !== null) onShowOnMap(primary);
          }}
        >
          Show on map
        </Button>
        <DisclosureButton disclosure={details} describedBy={titleId}>
          Details
        </DisclosureButton>
      </div>
      <DisclosureContent disclosure={details} className="person-card__details">
        <PersonDetails
          person={person}
          now={now}
          liveMinutes={liveMinutes}
          sharesBack={sharesBack}
          onShareBack={onShareBack}
          {...(onStopSharing === undefined ? {} : { onStopSharing })}
          onHide={onHide}
          hiding={hiding}
        />
      </DisclosureContent>
    </article>
  );
}
