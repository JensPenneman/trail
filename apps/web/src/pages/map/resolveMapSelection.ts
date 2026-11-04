import type { MapPerson } from "./MapPerson";
import { me } from "./me";
import type { MapSearch } from "./parseMapSearch";

/** Whose data the map shows, and which of their devices, as the page works with it. */
export interface MapSelection {
  /** The person selected, as the page knows them; null is the overview, nobody selected. */
  selected: MapPerson | null;
  /** Whether a device filter alone implied the selection, rather than the address naming them. */
  implied: boolean;
  /** The device filter as it applies to the selected person; null when all their devices show. */
  filter: readonly string[] | null;
  /**
   * The devices shown of one person: the filter's for the selected person,
   * every device of anyone else (the overview keeps everybody's position).
   */
  devicesOf(person: string): readonly string[];
  /**
   * The signed-in person's devices for the API: `deviceIds` null for all of
   * them (a device added later shows too); null when the filter leaves none of
   * theirs. The filter applies while Me is selected.
   */
  own: { deviceIds: readonly string[] | null } | null;
}

/**
 * Applies `?person=` and `?devices=` to the people and devices there are.
 * Until `complete` (the lists have loaded) an id nobody knows yet is kept, so a
 * deep link does not fall back to the overview while the people load;
 * afterwards it is dropped. A device filter without a person (a link from a
 * device's page) selects the one person whose devices they are, except in
 * Heat (`inHeat`), which is one's own whoever is selected: there the filter
 * applies to one's own devices and selects nobody.
 */
export function resolveMapSelection(
  search: Pick<MapSearch, "person" | "devices">,
  available: readonly MapPerson[],
  complete: boolean,
  inHeat = false,
): MapSelection {
  const deviceIds = new Set(
    available.flatMap((person) => person.devices.map((device) => device.id)),
  );
  const listed = complete
    ? (search.devices?.filter((id) => deviceIds.has(id)) ?? null)
    : search.devices;

  let key = search.person;
  if (key === null && !inHeat && listed !== null && listed.length > 0) {
    const owners = available.filter((person) =>
      person.devices.some((device) => listed.includes(device.id)),
    );
    const only = owners.length === 1 ? owners[0] : undefined;
    // Not loaded yet: a device's own page links here, so it is most likely one's own.
    if (only !== undefined && listed.every((id) => only.devices.some((d) => d.id === id))) {
      key = only.key;
    } else if (!complete) {
      key = me;
    }
  }
  const known = key === null ? undefined : available.find((person) => person.key === key);
  const selected =
    known ??
    (key === null || complete ? null : { key, name: "", devices: [] as MapPerson["devices"] });

  // The filter is the selected person's: ids of anyone else's devices do not count.
  const owner = selected ?? (inHeat ? available.find((person) => person.key === me) : undefined);
  const theirs =
    owner === undefined || listed === null || !complete
      ? listed
      : listed.filter((id) => owner.devices.some((device) => device.id === id));
  const filter = owner === undefined || theirs === null || theirs.length === 0 ? null : theirs;
  const filterKey = owner?.key ?? (inHeat ? me : null);

  const allOf = (person: string): readonly string[] =>
    (available.find((candidate) => candidate.key === person)?.devices ?? []).map(
      (device) => device.id,
    );
  const devicesOf = (person: string): readonly string[] =>
    filter === null || filterKey !== person
      ? allOf(person)
      : allOf(person).filter((id) => filter.includes(id));
  const ownShown = devicesOf(me);
  const own =
    filterKey !== me || filter === null
      ? { deviceIds: null }
      : ownShown.length === 0
        ? null
        : { deviceIds: ownShown };
  return { selected, implied: selected !== null && search.person === null, filter, devicesOf, own };
}
