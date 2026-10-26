import type { Person } from "@trail/contracts/person";
import type { MapPosition } from "../map/mapTypes";
import { personInitials } from "./personInitials";
import type { PersonColors } from "./usePersonColors";

/**
 * Where the people shown are: one marker with their initials per shared
 * device, in their colour. A coarse share is drawn as what it is, a circle
 * of its precision around a cell's centre.
 */
export function personPositions(
  people: readonly Person[],
  shown: (userId: string) => readonly string[],
  colors: PersonColors,
  live: (recordedAt: string) => boolean,
): MapPosition[] {
  return people.flatMap((person) =>
    person.devices.flatMap((device) =>
      device.location === null || !shown(person.userId).includes(device.id)
        ? []
        : [
            {
              id: `${person.userId}:${device.id}`,
              color: colors.hex(person.userId),
              slot: colors.slot(person.userId),
              lon: device.location.lon,
              lat: device.location.lat,
              accuracy: device.location.accuracy,
              coarse: device.location.precision !== "precise",
              live: live(device.location.recordedAt),
              initials: personInitials(person.displayName),
            },
          ],
    ),
  );
}
