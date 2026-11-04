import type { Track } from "@trail/contracts/track";
import { trackGapSeconds } from "@trail/contracts/trackSegments";
import type {
  LevelTrackSegment,
  LevelTracksResponse,
  LevelValue,
} from "@trail/contracts/transport";
import { modePalette } from "../../transport/modePalette";
import {
  edgeClasses,
  type PathPoint,
  rawAccuracyColumn,
  rawAltitudeColumn,
  rawSpeedColumn,
} from "./pathClasses";
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

type RunColouring = PathColouring & { by: "speed" | "time" | "altitude" | "accuracy" };

/** Colourings that cut a path into runs of a class (confidence colours a whole move). */
const coloured = (colouring: PathColouring): colouring is RunColouring =>
  colouring.by === "speed" ||
  colouring.by === "time" ||
  colouring.by === "altitude" ||
  colouring.by === "accuracy";

/** The column of a raw point the colouring reads, if any. */
const rawColumnOf = (by: RunColouring["by"]): number | null =>
  by === "altitude" ? rawAltitudeColumn : by === "accuracy" ? rawAccuracyColumn : null;

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
              speedColumn: rawSpeedColumn,
              valueColumn: rawColumnOf(colouring.by),
              ...(colouring.scale === undefined ? {} : { scale: colouring.scale }),
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

/**
 * How sure the mode of a move is: 0 sure (a mode the person chose, or a confidence of 0.8 or
 * more), 2 fairly sure, 4 unsure (under 0.5, or a move to review); null where there is no mode
 * to be sure of. The steps of the line ramp, the strongest the least certain.
 */
export function confidenceClass(segment: {
  confidence: number | null;
  needsReview: boolean;
  modeUser: string | null;
  kind: string;
}): number | null {
  if (segment.kind !== "move") return null;
  if (segment.needsReview) return 4;
  if (segment.modeUser !== null) return 0;
  if (segment.confidence === null) return null;
  if (segment.confidence < 0.5) return 4;
  return segment.confidence >= 0.8 ? 0 : 2;
}

/** A segment of a level's tracks with the colour it is drawn in; none: the mode's, or the device's. */
type ColouredSegment = LevelTrackSegment & { color?: string };
export type ColouredLevelTracks = Omit<LevelTracksResponse, "segments"> & {
  segments: ColouredSegment[];
};

/**
 * A level's tracks with colours: by speed or time of day a move or piece of track is split into its
 * runs (each keeps the segment's id and review mark; a stop keeps the stationary colour; a pause
 * inside a move is no cut), by the confidence of the mode a move is one colour, by device every
 * segment, stops included, has the device's colour, by mode the segments are as they were.
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
  if (colouring.by === "confidence") {
    // One colour for a whole move; a stop keeps its own, a piece of track no mode to be sure of.
    return {
      ...response,
      segments: response.segments.map((segment) =>
        segment.kind === "stop"
          ? segment
          : { ...segment, color: classColour(confidenceClass(segment), colouring) },
      ),
    };
  }
  if (!coloured(colouring)) return response;
  // The values the points carry after `t`, in the order the query asked for them.
  const asked = response.values?.indexOf(colouring.by as LevelValue) ?? -1;
  const valueColumn = asked < 0 ? null : 3 + asked;
  const segments = response.segments.flatMap((segment): ColouredSegment[] => {
    if (segment.kind === "stop" || segment.points.length < 2) return [segment];
    // A move is one line, as under Mode: a pause inside it is a stretch of some speed, not a cut.
    return runsOf(
      segment.points,
      edgeClasses(segment.points, {
        by: colouring.by,
        speedColumn: null,
        valueColumn,
        ...(colouring.scale === undefined ? {} : { scale: colouring.scale }),
        onFoot: colouring.onFoot === true,
        timeZone: colouring.timeZone,
      }),
    ).map((run) => ({ ...segment, points: run.points, color: classColour(run.cls, colouring) }));
  });
  return { ...response, segments };
}
