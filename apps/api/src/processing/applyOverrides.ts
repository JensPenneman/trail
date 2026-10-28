import { type ChosenMode, toggleEndingStopS } from "@trail/contracts/transport";
import type { OverrideSpan } from "./pipelineTypes";
import type { ProcessingConfig } from "./processingConfig";
import type { ScoredPart } from "./splitMoves";
import { familyOf } from "./travelFamily";

/** A stop of the window, by kept-point indices. */
interface DraftStop {
  kind: "stop";
  first: number;
  last: number;
  /** Its last point of its own (`Span.ownLast`): `last`, or the point before it. */
  ownLast: number;
  startT: number;
  endT: number;
  /**
   * When the stay it is part of began: its own start, or that of the stop it
   * continues (`continuesStop`) — the stored one before the window too; minus
   * infinity where that stay began before the window's toggles.
   */
  stayStartT: number;
}

/** A move (or part of one) of the window: kept-point indices, its scores, the person's mode. */
export interface DraftMove {
  kind: "move";
  first: number;
  last: number;
  startT: number;
  endT: number;
  /** Which detected move (series) the part belongs to. */
  move: number;
  part: ScoredPart;
  modeUser: ChosenMode | null;
  override: OverrideSpan | null;
}

export type Draft = DraftStop | DraftMove;

/** What applying overrides needs of the window: point times and scoring a part on its own. */
export interface OverrideContext {
  /** Time of kept point `index`. */
  timeAt: (index: number) => number;
  /** Scores kept points `first..last` of detected move `move` as a part. */
  rescore: (move: number, first: number, last: number) => ScoredPart;
  overrides: ProcessingConfig["overrides"];
}

/**
 * Where an override applies: a segment override its span; a toggle until the
 * first stay of `toggleEndingStopS` or more that began after it, or a move
 * after such a stay that the inference reads as another kind of travel
 * (`familyOf`). The first move it reaches is its own, all its parts, whatever
 * the inference reads in them (a ride partly read as a car, the walk to the
 * platform) — a change of trains does not end it, cycling home from the
 * station does. A stay counts from its first part: the parts the passes left
 * of the stay it was set in neither end it nor come after it.
 */
function effectiveSpan(
  override: OverrideSpan,
  segments: readonly Draft[],
): { from: number; to: number } | null {
  let to = override.to ?? Number.POSITIVE_INFINITY;
  if (override.kind === "toggle") {
    if (override.endsBy !== null) to = Math.min(to, override.endsBy);
    const family = familyOf(override.mode);
    // Whether a stay began since the toggle began — before this window too: only moves after
    // one can end it by kind.
    let afterStop = override.stoppedBefore;
    for (const segment of segments) {
      if (segment.startT <= override.from) continue;
      // A part of the stay the toggle was set in: the device has not left yet.
      if (segment.kind === "stop" && segment.stayStartT <= override.from) continue;
      const inferred = segment.kind === "move" ? familyOf(segment.part.verdict.mode) : null;
      const ends =
        segment.kind === "stop"
          ? segment.endT - segment.stayStartT >= toggleEndingStopS
          : afterStop && family !== null && inferred !== null && inferred !== family;
      if (ends) {
        to = Math.min(to, segment.startT);
        break;
      }
      if (segment.kind === "stop") afterStop = true;
    }
  }
  return to > override.from ? { from: override.from, to } : null;
}

/**
 * The person's corrections win (docs/architecture.md §17.5), applied last and
 * in the order they were made, so a later one wins where they overlap. A move
 * inside an override's span takes its mode; one that reaches beyond it is cut
 * at the span's edges, and the parts outside keep (and are scored for) what
 * the inference says. Parts too short to stand alone join the corrected part,
 * so an override still fits after the segments moved by a few seconds; an
 * override that only grazes a move leaves it alone. Stops never take a mode.
 */
export function applyOverrides(
  segments: readonly Draft[],
  overrides: readonly OverrideSpan[],
  context: OverrideContext,
): Draft[] {
  const ordered = [...overrides].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let result: Draft[] = [...segments];
  for (const override of ordered) {
    const span = effectiveSpan(override, result);
    if (span === null) continue;
    const next: Draft[] = [];
    for (const segment of result) {
      if (segment.kind !== "move" || segment.endT <= span.from || segment.startT >= span.to) {
        next.push(segment);
      } else if (span.from <= segment.startT && segment.endT <= span.to) {
        next.push({ ...segment, modeUser: override.mode, override });
      } else {
        next.push(...cutMove(segment, span, override, context));
      }
    }
    result = next;
  }
  return result;
}

/** Splits a move at an override's edges and gives the part inside the override's mode. */
function cutMove(
  move: DraftMove,
  span: { from: number; to: number },
  override: OverrideSpan,
  context: OverrideContext,
): Draft[] {
  const { timeAt, rescore } = context;
  const short = (part: ScoredPart) => part.features.durationS < context.overrides.sliverS;
  const indexNear = (t: number): number => {
    let best = move.first;
    for (let index = move.first + 1; index <= move.last; index += 1) {
      if (Math.abs(timeAt(index) - t) < Math.abs(timeAt(best) - t)) best = index;
    }
    return best;
  };
  const start = span.from > move.startT ? indexNear(span.from) : move.first;
  const end = span.to < move.endT ? indexNear(span.to) : move.last;
  if (end <= start) return [move];

  const before = start > move.first ? rescore(move.move, move.first, start) : null;
  const after = end < move.last ? rescore(move.move, end, move.last) : null;
  const inside = rescore(move.move, start, end);
  const majority = inside.features.durationS * 2 >= move.part.features.durationS;
  if (short(inside) && !majority) return [move];

  // Short leftovers join the corrected part.
  const keepBefore = before !== null && !short(before);
  const keepAfter = after !== null && !short(after);
  const first = keepBefore ? start : move.first;
  const last = keepAfter ? end : move.last;
  const corrected = first === start && last === end ? inside : rescore(move.move, first, last);

  const piece = (
    part: ScoredPart,
    from: number,
    to: number,
    modeUser: ChosenMode | null,
    by: OverrideSpan | null,
  ): DraftMove => ({
    kind: "move",
    first: from,
    last: to,
    startT: from === move.first ? move.startT : timeAt(from),
    endT: to === move.last ? move.endT : timeAt(to),
    move: move.move,
    part,
    modeUser,
    override: by,
  });
  const parts: Draft[] = [];
  if (keepBefore && before !== null) {
    parts.push(piece(before, move.first, start, move.modeUser, move.override));
  }
  parts.push(piece(corrected, first, last, override.mode, override));
  if (keepAfter && after !== null) {
    parts.push(piece(after, end, move.last, move.modeUser, move.override));
  }
  return parts;
}
