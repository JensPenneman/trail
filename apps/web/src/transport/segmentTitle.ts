import type { Segment } from "@trail/contracts/transport";
import { transportModeInfo } from "./transportModes";

/** "Train", "Stop": what a segment is, in a word or two. */
export function segmentTitle(segment: Segment): string {
  if (segment.kind === "stop") return "Stop";
  return transportModeInfo[segment.mode ?? "unknown"].label;
}
