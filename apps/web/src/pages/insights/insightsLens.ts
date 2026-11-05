import { type InsightsPeriod, periodRange } from "./insightsPeriod";

/*
 * Insights → the People map, as a lens: the map opens in Heat with the
 * period (and the devices) of the screen it was opened from. The map side —
 * the chip that names the lens and drops it, and the Back that returns here —
 * comes with the heat view's own change.
 *
 * Not here yet, on purpose: a mode's "Where you went" (`heat=move&mode=`)
 * waits for the heat view's second slice, and a place's "Show on the map"
 * for the camera parameter of the People map (`c=<lon>,<lat>,<zoom>`) to be
 * released. Each adds a row to its own screen and a function to this file.
 */

/**
 * Where the time went in the period, on the map: Heat of the time spent, from the first day to
 * the last, and the devices counted. All of the history leaves out both days, which the map reads
 * as the whole of it.
 */
export function timeOnMap(
  period: InsightsPeriod,
  devices: readonly string[] | null,
  today: string,
): string {
  const params = new URLSearchParams({ view: "heat", heat: "time" });
  const { from, to } = periodRange(period, today);
  if (period.kind !== "all") {
    if (from !== null) params.set("from", from);
    params.set("to", to);
  }
  if (devices !== null) params.set("devices", devices.join(","));
  return `/?${params.toString()}`;
}
