import type { MapPerson } from "./MapPerson";
import { me } from "./me";
import type { MapSearch } from "./parseMapSearch";

/** Whose data the map shows, and which of their devices, as the page works with it. */
export interface MapSelection {
  /** The selected people the page knows, in the order they are offered. */
  people: readonly MapPerson[];
  /** The device filter as it applies; null when every device of the selected people shows. */
  filter: readonly string[] | null;
  /** The devices shown of one selected person. */
  devicesOf(person: string): readonly string[];
  /**
   * The signed-in person's devices for the API: `deviceIds` null for all of
   * them (a device added later shows too); null when none of theirs show.
   */
  own: { deviceIds: readonly string[] | null } | null;
}

/**
 * Applies `?people=` and `?devices=` to the people and devices there are.
 * Until `complete` (the lists have loaded) ids nobody knows yet are kept, so a
 * deep link does not fall back to Me while the people load; afterwards they
 * are dropped, and a selection left empty becomes Me with all their devices —
 * an outdated link shows something rather than an empty map.
 */
export function resolveMapSelection(
  search: Pick<MapSearch, "people" | "devices">,
  available: readonly MapPerson[],
  complete: boolean,
): MapSelection {
  const known = new Set(available.map((person) => person.key));
  const requested = complete ? search.people.filter((key) => known.has(key)) : search.people;
  const keys = requested.length === 0 ? [me] : requested;
  const people = available.filter((person) => keys.includes(person.key));

  const deviceIds = new Set(
    available.flatMap((person) => person.devices.map((device) => device.id)),
  );
  const listed = complete
    ? (search.devices?.filter((id) => deviceIds.has(id)) ?? null)
    : search.devices;
  const filter = listed === null || listed.length === 0 ? null : listed;

  const devicesOf = (key: string): readonly string[] =>
    (people.find((person) => person.key === key)?.devices ?? [])
      .map((device) => device.id)
      .filter((id) => filter === null || filter.includes(id));
  const ownShown = devicesOf(me);
  const own = !keys.includes(me)
    ? null
    : filter === null
      ? { deviceIds: null }
      : ownShown.length === 0
        ? null
        : { deviceIds: ownShown };
  return { people, filter, devicesOf, own };
}
