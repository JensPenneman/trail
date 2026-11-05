import type { ProcessingLevel, TransportMode } from "@trail/contracts/transport";
import { useCallback, useMemo } from "react";
import type { RangeParams } from "../api/queryKeys";
import { useFormatter } from "../format/useFormatter";
import type { MapTrack, MapTransportSegment } from "../map/mapTypes";
import { colourLevelTracks } from "../map/pathColour/colourRuns";
import { altitudeScale } from "../map/pathColour/pathClasses";
import { levelValuesFor, type PathColouring } from "../map/pathColour/pathColours";
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
  const { dark, device, colouring } = colors;
  // Altitude and accuracy are asked for only by the colourings that read them: Raw has them all.
  const values = colouring === undefined ? [] : levelValuesFor(colouring.by);
  const levelTracks = useLevelTracks(
    level === "raw" || range === null
      ? null
      : { ...range, level, ...(values.length === 0 ? {} : { values }) },
  );
  const data = levelTracks.data;
  const pending =
    level !== "raw" && range !== null && (levelTracks.isPending || levelTracks.isPlaceholderData);
  const mode = useCallback(
    (value: TransportMode) => modePalette[dark ? "dark" : "light"][value],
    [dark],
  );
  // The colouring, the layers it makes and the legend depend on the data, not on the playback
  // cursor: they are worked out once for the data; the cursor only cuts the coloured lines.
  const coloured = useMemo(() => {
    const asked: PathColouring = colouring ?? {
      by: level === "inferred" ? "mode" : "device",
      dark,
      timeZone: "UTC",
    };
    if (level === "raw" || range === null || data === undefined) {
      return {
        response: null,
        layers: null,
        modes: new Set<TransportMode>(),
        review: false,
        stopPaths: false,
        gaps: false,
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
      };
    }
    const palette = modePalette[dark ? "dark" : "light"];
    const found = new Set<TransportMode>();
    let seenReview = false;
    let moves = 0;
    let onFoot = true;
    for (const segment of data.segments) {
      if (segment.kind === "stop") found.add("stationary");
      // Points not processed yet may be driving: no paces while some are drawn.
      else if (segment.kind === "track") onFoot = false;
      else if (segment.kind === "move") {
        found.add(segment.mode ?? "unknown");
        moves += 1;
        if (segment.mode !== "walking" && segment.mode !== "running") onFoot = false;
      }
      if (segment.needsReview) seenReview = true;
    }
    // Paces where every move drawn is on foot; elsewhere speeds.
    const colouredBy: PathColouring = {
      ...asked,
      onFoot: data.level === "inferred" && moves > 0 && onFoot,
    };
    if (asked.by === "altitude") {
      // The classes are cut from what the level's tracks carry, as Raw's are from its own.
      const at = data.values?.indexOf("altitude") ?? -1;
      const heights: number[] = [];
      if (at >= 0) {
        for (const segment of data.segments) {
          for (const point of segment.points) {
            const height = point[3 + at];
            if (typeof height === "number") heights.push(height);
          }
        }
      }
      const scale = altitudeScale(heights);
      if (scale !== null) colouredBy.scale = scale;
    }
    const response = colourLevelTracks(data, colouredBy, device);
    const layers = levelTracksToMap(response, { device, mode: (value) => palette[value] });
    const inferred = data.level === "inferred";
    const modes = inferred ? found : new Set<TransportMode>();
    const review = inferred && seenReview;
    const stopPaths = layers.transport.some(showsPath);
    const gaps = layers.transport.some((segment) => segment.kind === "gap");
    return {
      response,
      layers,
      modes,
      review,
      stopPaths,
      gaps,
      legend: pathLegend(
        colouredBy,
        {
          deviceIds: [...new Set(data.segments.map((segment) => segment.deviceId))],
          modes,
          review,
          stopPaths,
          gaps,
          stops: found.has("stationary"),
          unknownClass:
            ["speed", "altitude", "accuracy", "confidence"].includes(colouredBy.by) &&
            response.segments.some(
              (segment) => segment.kind !== "stop" && segment.color === palette.unknown,
            ),
        },
        format,
      ),
    };
  }, [level, range, data, raw, dark, device, colouring, format]);
  const { response, layers: whole, modes, review, stopPaths, gaps, legend } = coloured;
  // Only the cursor cuts: without one the layers are the whole.
  const layers = useMemo(
    () =>
      response === null || whole === null
        ? null
        : until === undefined
          ? whole
          : levelTracksToMap(response, { device, mode }, until),
    [response, whole, device, mode, until],
  );
  return useMemo(
    () => ({
      ...(layers ?? { tracks: raw, transport: [] }),
      modes,
      review,
      stopPaths,
      gaps,
      legend,
      available:
        level === "raw" ? "raw" : response === null ? null : (data?.availableLevel ?? null),
      pending,
      fetching: levelTracks.isFetching,
    }),
    [
      layers,
      raw,
      modes,
      review,
      stopPaths,
      gaps,
      legend,
      level,
      response,
      data,
      pending,
      levelTracks.isFetching,
    ],
  );
}
