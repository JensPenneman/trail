import type { Person } from "@trail/contracts/person";
import type { ComponentProps } from "react";
import type { Formatter } from "../format/createFormatter";
import { precisionInfo } from "../sharing/shareText";
import { BatteryGlyph } from "../ui/BatteryGlyph";
import { describeActivity } from "./describeActivity";
import type { PersonSummary } from "./PersonSummary";
import { primaryDevice } from "./primaryDevice";

type SummaryProps = Pick<
  ComponentProps<typeof PersonSummary>,
  "avatar" | "freshness" | "doing" | "distance" | "battery"
>;

/**
 * What a row in the list and the detail of someone who shares say of them
 * alike: who, how fresh their position is and what they are doing, how far
 * and the battery when the share includes it.
 */
export function personSummaryProps(
  person: Person,
  colorSlot: number,
  now: number,
  liveMinutes: number,
  format: Formatter,
): SummaryProps {
  const primary = primaryDevice(person.devices);
  const location = primary?.location ?? null;
  const live = location !== null && now - Date.parse(location.recordedAt) <= liveMinutes * 60_000;
  // A coarse position always says how coarse, after what they are doing: its distance is to the
  // centre of a cell, as the map draws a circle rather than a spot (positionExtent).
  const within = precisionInfo[person.share.precision].within;
  const activity =
    location === null
      ? null
      : describeActivity(location, primary?.activity ?? null, format, { live });
  const doing =
    person.devices.length === 0
      ? "Shares no device right now"
      : location === null
        ? "No recent location"
        : within === null
          ? activity
          : activity === null
            ? within
            : `${activity} · ${within.toLowerCase()}`;
  return {
    avatar: { name: person.displayName, slot: colorSlot },
    freshness: location === null ? null : { recordedAt: location.recordedAt, live },
    doing,
    ...(primary?.distanceM === null || primary?.distanceM === undefined
      ? {}
      : {
          distance: (
            <>
              <span className="visually-hidden">Distance from you: </span>
              {within === null ? null : (
                <>
                  <span aria-hidden="true">≈ </span>
                  <span className="visually-hidden">about </span>
                </>
              )}
              {format.distance(primary.distanceM)}
            </>
          ),
        }),
    ...(person.share.includeDetails && primary?.battery != null
      ? { battery: <BatteryGlyph battery={primary.battery} /> }
      : {}),
  };
}
