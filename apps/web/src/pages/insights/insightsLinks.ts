import type { InsightsMove } from "@trail/contracts/insights";
import { localDateOf } from "../../time/localDateOf";

/**
 * The address of an Insights screen with the period and devices of this one:
 * a period chosen on one screen holds on the others.
 */
export function insightsLink(path: string, current: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const key of ["period", "from", "to", "devices"]) {
    const value = current.get(key);
    if (value !== null && value !== "") next.set(key, value);
  }
  const search = next.toString();
  return search === "" ? path : `${path}?${search}`;
}

/** The History view of the move's local day, as the signed-in person, with the move's details open. */
export const moveOnMap = (move: InsightsMove, timeZone: string): string =>
  `/?${new URLSearchParams({
    view: "history",
    date: localDateOf(move.startedAt, timeZone),
    person: "me",
    segment: move.segmentId,
  }).toString()}`;
