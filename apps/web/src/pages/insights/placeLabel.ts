import type { PlaceSummary } from "@trail/contracts/insights";
import type { Formatter } from "../../format/createFormatter";

/** "9 visits", "1 visit". */
export const visitsText = (visits: number, count: (value: number) => string): string =>
  `${count(visits)} ${visits === 1 ? "visit" : "visits"}`;

/** Within this a place is the stop; within the next, near it (metres). */
const atStopM = 30;

/**
 * What a place is called: the stop it is at (within 30 m), "Near <stop>"
 * (within 150 m), the road its stays were on; else "Unnamed place" with its
 * coordinates to tell it by.
 */
export function placeLabel(
  place: Pick<PlaceSummary, "name" | "centre">,
  format: Formatter,
): { title: string; detail: string | null } {
  const { name, centre } = place;
  if (name === null) {
    const [lon, lat] = centre;
    return { title: "Unnamed place", detail: format.coordinates(lat, lon, 4) };
  }
  if (name.source === "stop" && name.distanceM > atStopM) {
    return { title: `Near ${name.text}`, detail: null };
  }
  return { title: name.text, detail: null };
}
