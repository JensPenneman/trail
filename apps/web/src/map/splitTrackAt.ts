import type { TrackPoint } from "@trail/contracts/track";
import { positionAt } from "./positionAt";

/**
 * A continuous piece of track cut at `time` (epoch seconds): what was played
 * by then and what is still ahead. Both parts share the cursor's position
 * (interpolated, as `positionAt` has it) so the two lines meet; a piece
 * entirely on one side is returned whole, and the cursor in a recording gap
 * or outside the piece cuts it between the points around it.
 */
export function splitTrackAt<P extends readonly [number, number, number, ...unknown[]]>(
  points: readonly P[],
  time: number,
): {
  played: readonly (readonly [number, number])[];
  ahead: readonly (readonly [number, number])[];
} {
  const line = (list: readonly P[]) => list.map((point) => [point[0], point[1]] as const);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return { played: [], ahead: [] };
  if (time >= last[2]) return { played: line(points), ahead: [] };
  if (time <= first[2]) return { played: [], ahead: line(points) };
  const index = points.findIndex((point) => point[2] > time);
  const played = line(points.slice(0, index));
  const ahead = line(points.slice(index));
  // The cursor's own position joins the two lines; none inside a gap, where they stay apart.
  const cursor = positionAt(points as unknown as readonly TrackPoint[], time);
  if (cursor !== null) {
    const spot = [cursor.lon, cursor.lat] as const;
    played.push(spot);
    ahead.unshift(spot);
  }
  return { played, ahead };
}
