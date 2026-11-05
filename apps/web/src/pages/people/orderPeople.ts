import type { Person } from "@trail/contracts/person";
import { primaryDevice } from "../../people/primaryDevice";

/**
 * The people who share, in the order the list reads: those live now by name,
 * then the rest by when they were last seen, newest first, then those with no
 * location by name. A row only moves when someone goes live or stale, never
 * with a position that keeps coming in.
 */
export function orderPeople(people: readonly Person[], now: number, liveMinutes: number): Person[] {
  const seen = (person: Person): number | null => {
    const location = primaryDevice(person.devices)?.location ?? null;
    return location === null ? null : Date.parse(location.recordedAt);
  };
  const rank = (person: Person): 0 | 1 | 2 => {
    const at = seen(person);
    if (at === null) return 2;
    return now - at <= liveMinutes * 60_000 ? 0 : 1;
  };
  return [...people].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) === 1) {
      const byTime = (seen(b) ?? 0) - (seen(a) ?? 0);
      if (byTime !== 0) return byTime;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}
