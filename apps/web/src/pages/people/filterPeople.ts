import type { Person } from "@trail/contracts/person";
import { fold } from "../../format/fold";

/** From this many people the list offers a search. */
export const searchFrom = 8;

/** The people whose name holds the query, ignoring case and accents; all of them for an empty one. */
export function filterPeople(people: readonly Person[], query: string): Person[] {
  const wanted = fold(query);
  if (wanted === "") return [...people];
  return people.filter((person) => fold(person.displayName).includes(wanted));
}
