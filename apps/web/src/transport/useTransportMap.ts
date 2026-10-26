import type { ProcessingLevel, TransportMode } from "@trail/contracts/transport";
import { useMemo } from "react";
import type { RangeParams } from "../api/queryKeys";
import type { MapTrack, MapTransportSegment } from "../map/mapTypes";
import { useLevelTracks } from "../queries/useLevelTracks";
import { levelTracksToMap } from "./levelTracksToMap";
import { modePalette } from "./modePalette";

export interface TransportMap {
  tracks: readonly MapTrack[];
  transport: readonly MapTransportSegment[];
  /** The modes on the map, for the legend. */
  modes: ReadonlySet<TransportMode>;
  /** A move to review is on the map. */
  review: boolean;
  /** The level every point shown reached; null while the level's tracks load. */
  available: ProcessingLevel | null;
  /** The level's tracks are loading or belong to the previous range. */
  pending: boolean;
  fetching: boolean;
}

/**
 * What the map shows for a range at a level: the raw tracks the page already
 * has (`raw`, which the live stream extends) or the level's tracks from
 * `/api/v1/tracks`, until they arrive the raw ones. A null range asks for
 * nothing (a view that is not shown). `colors` are those of the map's
 * background, which need not be the page's.
 */
export function useTransportMap(
  range: RangeParams | null,
  level: ProcessingLevel,
  raw: readonly MapTrack[],
  colors: { dark: boolean; device: (deviceId: string) => string },
): TransportMap {
  const levelTracks = useLevelTracks(
    level === "raw" || range === null ? null : { ...range, level },
  );
  const { dark, device } = colors;
  const data = levelTracks.data;
  return useMemo(() => {
    const pending =
      level !== "raw" && range !== null && (levelTracks.isPending || levelTracks.isPlaceholderData);
    if (level === "raw" || range === null || data === undefined) {
      return {
        tracks: raw,
        transport: [],
        modes: new Set<TransportMode>(),
        review: false,
        available: level === "raw" ? "raw" : null,
        pending,
        fetching: levelTracks.isFetching,
      };
    }
    const palette = modePalette[dark ? "dark" : "light"];
    const layers = levelTracksToMap(data, { device, mode: (mode) => palette[mode] });
    const modes = new Set<TransportMode>();
    let review = false;
    for (const segment of data.segments) {
      if (segment.kind === "stop") modes.add("stationary");
      else if (segment.kind === "move") modes.add(segment.mode ?? "unknown");
      if (segment.needsReview) review = true;
    }
    return {
      ...layers,
      modes: data.level === "inferred" ? modes : new Set<TransportMode>(),
      review: data.level === "inferred" && review,
      available: data.availableLevel,
      pending,
      fetching: levelTracks.isFetching,
    };
  }, [
    level,
    range,
    data,
    raw,
    dark,
    device,
    levelTracks.isPending,
    levelTracks.isPlaceholderData,
    levelTracks.isFetching,
  ]);
}
