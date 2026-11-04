import type { Track } from "@trail/contracts/track";
import { trackSegments } from "@trail/contracts/trackSegments";
import type { MapTrack } from "./mapTypes";
import { splitTrackAt } from "./splitTrackAt";

/**
 * API tracks → drawable segments (split at recording gaps) in each device's
 * colour. With `until` (epoch seconds: the playback cursor, rounded by `splitTime`) a track becomes
 * what was played by then and, dimmed, what is still ahead.
 */
export function tracksToMap(
  tracks: readonly Track[],
  colorOf: (deviceId: string) => string,
  until?: number,
): MapTrack[] {
  if (until === undefined) {
    return tracks.map((track) => ({
      id: track.deviceId,
      color: colorOf(track.deviceId),
      segments: trackSegments(track.points).map((segment) =>
        segment.map((point) => [point[0], point[1]] as const),
      ),
    }));
  }
  return tracks.flatMap((track) => {
    const played: (readonly (readonly [number, number])[])[] = [];
    const ahead: (readonly (readonly [number, number])[])[] = [];
    for (const segment of trackSegments(track.points)) {
      const cut = splitTrackAt(segment, until);
      if (cut.played.length > 0) played.push(cut.played);
      if (cut.ahead.length > 0) ahead.push(cut.ahead);
    }
    const color = colorOf(track.deviceId);
    // The faded part first: where a route doubles back, the played line is drawn over it.
    return [
      ...(ahead.length === 0
        ? []
        : [{ id: track.deviceId, color, segments: ahead, dimmed: true as const }]),
      ...(played.length === 0 ? [] : [{ id: track.deviceId, color, segments: played }]),
    ];
  });
}
