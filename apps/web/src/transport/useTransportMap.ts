import type { ProcessingLevel, TransportMode } from "@trail/contracts/transport";
import { useMemo } from "react";
import type { RangeParams } from "../api/queryKeys";
import { useFormatter } from "../format/useFormatter";
import type { MapTrack, MapTransportSegment } from "../map/mapTypes";
import { colourLevelTracks } from "../map/pathColour/colourRuns";
import type { PathColouring } from "../map/pathColour/pathColours";
import { type PathLegendModel, pathLegend } from "../map/pathColour/pathLegend";
import { showsPath } from "../map/transportFeatures";
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
  /** A stop is drawn with the path within it (dotted). */
  stopPaths: boolean;
  /** A recording gap is bridged with a connector (dashed). */
  gaps: boolean;
  /** What the lines are coloured by now and how to say it: the key, the classes, the line styles. */
  legend: PathLegendModel;
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
 * background, which need not be the page's. `until` (epoch seconds: the
 * playback cursor, rounded by `splitTime` so that the split moves four times a
 * second at most) dims what lies after it; `raw` is then the caller's to cut.
 */
export function useTransportMap(
  range: RangeParams | null,
  level: ProcessingLevel,
  raw: readonly MapTrack[],
  colors: {
    dark: boolean;
    device: (deviceId: string) => string;
    /** How the lines are coloured; the mode colours where it is left out. */
    colouring?: PathColouring;
  },
  until?: number,
): TransportMap {
  const format = useFormatter();
  const levelTracks = useLevelTracks(
    level === "raw" || range === null ? null : { ...range, level },
  );
  const { dark, device, colouring } = colors;
  const data = levelTracks.data;
  return useMemo(() => {
    const pending =
      level !== "raw" && range !== null && (levelTracks.isPending || levelTracks.isPlaceholderData);
    const asked: PathColouring = colouring ?? {
      by: level === "inferred" ? "mode" : "device",
      dark,
      timeZone: "UTC",
    };
    if (level === "raw" || range === null || data === undefined) {
      return {
        legend: pathLegend(
          asked,
          {
            deviceIds: [...new Set(raw.map((track) => track.id))],
            modes: new Set<TransportMode>(),
            review: false,
            stopPaths: false,
            gaps: false,
          },
          format,
        ),
        tracks: raw,
        transport: [],
        modes: new Set<TransportMode>(),
        review: false,
        stopPaths: false,
        gaps: false,
        available: level === "raw" ? "raw" : null,
        pending,
        fetching: levelTracks.isFetching,
      };
    }
    const palette = modePalette[dark ? "dark" : "light"];
    const modes = new Set<TransportMode>();
    let review = false;
    let moves = 0;
    let onFoot = true;
    for (const segment of data.segments) {
      if (segment.kind === "stop") modes.add("stationary");
      else if (segment.kind === "move") {
        modes.add(segment.mode ?? "unknown");
        moves += 1;
        if (segment.mode !== "walking" && segment.mode !== "running") onFoot = false;
      }
      if (segment.needsReview) review = true;
    }
    // Paces where every move drawn is on foot; elsewhere speeds.
    const colouredBy: PathColouring = {
      ...asked,
      onFoot: data.level === "inferred" && moves > 0 && onFoot,
    };
    const layers = levelTracksToMap(
      colourLevelTracks(data, colouredBy, device),
      { device, mode: (mode) => palette[mode] },
      until,
    );
    const stopPaths = layers.transport.some(showsPath);
    const gaps = layers.transport.some((segment) => segment.kind === "gap");
    return {
      ...layers,
      legend: pathLegend(
        colouredBy,
        {
          deviceIds: [...new Set(data.segments.map((segment) => segment.deviceId))],
          modes: data.level === "inferred" ? modes : new Set<TransportMode>(),
          review: data.level === "inferred" && review,
          stopPaths,
          gaps,
        },
        format,
      ),
      modes: data.level === "inferred" ? modes : new Set<TransportMode>(),
      review: data.level === "inferred" && review,
      stopPaths,
      gaps,
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
    colouring,
    format,
    until,
    levelTracks.isPending,
    levelTracks.isPlaceholderData,
    levelTracks.isFetching,
  ]);
}
