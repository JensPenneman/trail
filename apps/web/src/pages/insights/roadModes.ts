import type { TransportMode } from "@trail/contracts/transport";

/** Modes on roads and paths: their page shows the distance by road class. */
export const roadModes: ReadonlySet<TransportMode> = new Set([
  "walking",
  "running",
  "cycling",
  "car",
  "bus",
]);

/** Modes on rails: their page shows the share on track and the halts at stations. */
export const railModes: ReadonlySet<TransportMode> = new Set(["train", "tram", "metro"]);
