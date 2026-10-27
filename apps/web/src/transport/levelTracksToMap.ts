import type { LevelTracksResponse, TransportMode } from "@trail/contracts/transport";
import { metresBetween, visibleGapM } from "../map/lineGeometry";
import type { MapTrack, MapTransportSegment } from "../map/mapTypes";

/**
 * Tracks at a level → what the map draws. The Transport level gives stops and
 * moves in the colours of their modes (and points not processed yet as plain
 * track in the device's colour), a stop with its place, its spread and the
 * points it spans, and a connector wherever a device's line jumps from one
 * segment of the timeline to the next: where the next one starts after the
 * last point of the one before — a recording gap, or the way a stop's phone
 * went before it resumed — more than 25 m away. Nobody vanishes from the map.
 * The other levels give tracks in device colours, as the raw level always did.
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
  const transport: MapTransportSegment[] = [];
  // Where each device's line got to: the last point of its previous stop or move, and when.
  const reached = new Map<string, readonly [number, number, number]>();
  for (const [index, segment] of response.segments.entries()) {
    const points = line(segment.points);
    if (segment.kind === "track") {
      // Points not processed yet are no part of the timeline: no connector to or from them.
      reached.delete(segment.deviceId);
    } else {
      const first = segment.points[0];
      const before = reached.get(segment.deviceId);
      // Consecutive segments meet at their boundary point; a later first point is a jump.
      if (
        before !== undefined &&
        first !== undefined &&
        first[2] > before[2] &&
        metresBetween([before[0], before[1]], [first[0], first[1]]) > visibleGapM
      ) {
        transport.push({
          id: `gap-${segment.deviceId}-${index}`,
          selectable: false,
          kind: "gap",
          color: colors.mode("unknown"),
          review: false,
          line: [
            [before[0], before[1]],
            [first[0], first[1]],
          ],
          place: null,
          spreadM: null,
        });
      }
      const last = segment.points.at(-1);
      if (last !== undefined) reached.set(segment.deviceId, last);
    }
    transport.push({
      id: segment.id ?? `track-${segment.deviceId}-${index}`,
      selectable: segment.id !== null,
      kind: segment.kind,
      color:
        segment.kind === "track"
          ? colors.device(segment.deviceId)
          : colors.mode(segment.kind === "stop" ? "stationary" : (segment.mode ?? "unknown")),
      review: segment.needsReview,
      line: points,
      place: segment.centroid === null ? null : [segment.centroid.lon, segment.centroid.lat],
      spreadM: segment.kind === "stop" ? segment.spreadM : null,
    });
  }
  return { tracks: [], transport };
}
