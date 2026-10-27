import type { Person } from "@trail/contracts/person";

/**
 * Whether someone's share includes where they have been: history is only ever
 * shared precisely, and asking for anything else is refused (404) — so the
 * page never asks.
 */
export function sharesHistory(person: Person): boolean {
  return person.share.precision === "precise" && person.share.historyDays !== null;
}
