import type { Track } from "@trail/contracts/track";
import { trackSegments } from "@trail/contracts/trackSegments";
import type { MapTrack } from "./mapTypes";

/** API tracks → drawable segments (split at recording gaps) in each device's colour. */
export function tracksToMap(
  tracks: readonly Track[],
  colorOf: (deviceId: string) => string,
): MapTrack[] {
  return tracks.map((track) => ({
    id: track.deviceId,
    color: colorOf(track.deviceId),
    segments: trackSegments(track.points).map((segment) =>
      segment.map((point) => [point[0], point[1]] as const),
    ),
  }));
}
