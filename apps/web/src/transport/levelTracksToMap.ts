import type { LevelTracksResponse, TransportMode } from "@trail/contracts/transport";
import type { MapTrack, MapTransportSegment } from "../map/mapTypes";

/**
 * Tracks at a level → what the map draws. The Transport level gives stops and
 * moves in the colours of their modes (and points not processed yet as plain
 * track in the device's colour); the other levels give tracks in device
 * colours, as the raw level always did.
 */
export function levelTracksToMap(
  response: LevelTracksResponse,
  colors: { device: (deviceId: string) => string; mode: (mode: TransportMode) => string },
): { tracks: MapTrack[]; transport: MapTransportSegment[] } {
  const line = (points: readonly (readonly [number, number, number])[]) =>
    points.map((point) => [point[0], point[1]] as const);
  if (response.level !== "inferred") {
    const byDevice = new Map<string, (readonly (readonly [number, number])[])[]>();
    for (const segment of response.segments) {
      const lines = byDevice.get(segment.deviceId) ?? [];
      lines.push(line(segment.points));
      byDevice.set(segment.deviceId, lines);
    }
    return {
      tracks: [...byDevice].map(([deviceId, segments]) => ({
        id: deviceId,
        color: colors.device(deviceId),
        segments,
      })),
      transport: [],
    };
  }
  const transport = response.segments.map((segment, index): MapTransportSegment => {
    const selectable = segment.id !== null;
    return {
      id: segment.id ?? `track-${segment.deviceId}-${index}`,
      selectable,
      kind: segment.kind,
      color:
        segment.kind === "track"
          ? colors.device(segment.deviceId)
          : colors.mode(segment.kind === "stop" ? "stationary" : (segment.mode ?? "unknown")),
      review: segment.needsReview,
      line: line(segment.points),
    };
  });
  return { tracks: [], transport };
}
