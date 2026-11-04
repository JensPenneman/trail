import type { Track } from "@trail/contracts/track";
import { trackGapSeconds } from "@trail/contracts/trackSegments";
import type { LevelTrackSegment, LevelTracksResponse } from "@trail/contracts/transport";
import { modePalette } from "../../transport/modePalette";
import { edgeClasses, type PathPoint } from "./pathClasses";
import type { PathColouring } from "./pathColours";
import { speedRamp, timeTones } from "./pathPalette";

/** A run of a path: the points of consecutive intervals of one class, ends shared with its neighbours. */
export interface Run<P> {
  /** The class; null where the speed is unknown. */
  cls: number | null;
  points: P[];
}

/**
 * The maximal runs of a gap-free path whose intervals share a class: a run holds the points from
 * the start of its first interval to the end of its last, so that neighbouring runs meet in a point
 * and the line is whole. One class is one run.
 */
export function runsOf<P>(points: readonly P[], classes: readonly (number | null)[]): Run<P>[] {
  const runs: Run<P>[] = [];
  let start = 0;
  for (let edge = 1; edge <= classes.length; edge += 1) {
    if (edge < classes.length && classes[edge] === classes[start]) continue;
    runs.push({ cls: classes[start] ?? null, points: points.slice(start, edge + 1) });
    start = edge;
  }
  return runs;
}

/** A path cut where recording paused for more than ten minutes: no line crosses a gap. */
function withoutGaps<P extends PathPoint>(points: readonly P[]): P[][] {
  const pieces: P[][] = [];
  let current: P[] = [];
  for (const point of points) {
    const before = current.at(-1);
    if (before !== undefined && point[2] - before[2] > trackGapSeconds) {
      pieces.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

/** The colour of a class on the map in `colouring`; unknown speeds take the unknown mode's. */
export function classColour(cls: number | null, colouring: PathColouring): string {
  const scheme = colouring.dark ? "dark" : "light";
  if (cls === null) return modePalette[scheme].unknown;
  const palette = colouring.by === "time" ? timeTones[scheme] : speedRamp[scheme];
  return palette[cls] ?? modePalette[scheme].unknown;
}

const coloured = (
  colouring: PathColouring,
): colouring is PathColouring & { by: "speed" | "time" } =>
  colouring.by === "speed" || colouring.by === "time";

/** A track with the colour its pieces are drawn in; none: the device's. */
export type ColouredTrack = Track & { color?: string };

/**
 * Raw tracks as the pieces they are coloured in: by speed or time of day each track is cut into
 * runs of one class, each its own track with its colour; by device or mode (a level's only) they
 * are as they were.
 */
export function colourTracks(tracks: readonly Track[], colouring: PathColouring): ColouredTrack[] {
  if (!coloured(colouring)) return [...tracks];
  return tracks.flatMap((track) =>
    withoutGaps(track.points).flatMap((piece) =>
      piece.length < 2
        ? []
        : runsOf(
            piece,
            edgeClasses(piece, {
              by: colouring.by,
              raw: true,
              onFoot: colouring.onFoot === true,
              timeZone: colouring.timeZone,
            }),
          ).map((run) => ({
            ...track,
            points: run.points,
            color: classColour(run.cls, colouring),
          })),
    ),
  );
}

/** A segment of a level's tracks with the colour it is drawn in; none: the mode's, or the device's. */
type ColouredSegment = LevelTrackSegment & { color?: string };
export type ColouredLevelTracks = Omit<LevelTracksResponse, "segments"> & {
  segments: ColouredSegment[];
};

/**
 * A level's tracks with colours: by speed or time of day a move or piece of track is split into its
 * runs (each keeps the segment's id and review mark; a stop keeps the stationary colour), by device
 * every segment, stops included, has the device's colour, by mode the segments are as they were.
 */
export function colourLevelTracks(
  response: LevelTracksResponse,
  colouring: PathColouring,
  device: (deviceId: string) => string,
): ColouredLevelTracks {
  if (colouring.by === "mode") return response;
  if (colouring.by === "device") {
    return response.level === "inferred"
      ? {
          ...response,
          segments: response.segments.map((segment) => ({
            ...segment,
            color: device(segment.deviceId),
          })),
        }
      : response;
  }
  if (!coloured(colouring)) return response;
  const segments = response.segments.flatMap((segment): ColouredSegment[] => {
    if (segment.kind === "stop" || segment.points.length < 2) return [segment];
    const pieces = withoutGaps(segment.points);
    return pieces.flatMap((piece) =>
      piece.length < 2
        ? []
        : runsOf(
            piece,
            edgeClasses(piece, {
              by: colouring.by,
              raw: false,
              onFoot: colouring.onFoot === true,
              timeZone: colouring.timeZone,
            }),
          ).map((run) => ({
            ...segment,
            points: run.points,
            color: classColour(run.cls, colouring),
          })),
    );
  });
  return { ...response, segments };
}
