import type { InsightsOverview, InsightsTotals } from "@trail/contracts/insights";
import type { TransportMode } from "@trail/contracts/transport";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsOverview } from "../../queries/useInsightsOverview";
import { comparisonName, comparisonOf, daysBefore } from "./insightsPeriod";
import type { InsightsPeriodState } from "./useInsightsPeriod";

/** What the period on screen is compared with, once it is known. */
export interface Comparison {
  /** What follows "than": "September", "the same days of October", "the 12 days before". */
  name: string;
  /** The totals of the days compared with. */
  totals: InsightsTotals;
  /** The distance of one mode in those days. */
  modeDistanceM: (mode: TransportMode) => number;
  /** Nothing was recorded in those days (no moves, no stops): there is nothing to compare with. */
  empty: boolean;
}

/**
 * The comparison of a screen's period. A calendar period asks for the days
 * before it (all of them, or as far as the period has got) in a second
 * overview, so that the modes can be compared too; a custom or rolling period
 * keeps the API's own previous period (as many days just before), whose modes
 * are known by their change in distance. All of the history has no earlier.
 * Null until the answer is there, and where there is nothing to compare.
 */
export function useInsightsComparison(
  state: InsightsPeriodState,
  overview: InsightsOverview | undefined,
  { enabled = true } = {},
): Comparison | null {
  const format = useFormatter();
  const { period, today } = state;
  const calendar = comparisonOf(period, today);
  const second = useInsightsOverview(
    {
      from: calendar?.from ?? null,
      to: calendar?.to ?? today,
      deviceIds: state.devices,
      mode: null,
    },
    { enabled: enabled && calendar !== null },
  );
  if (period.kind === "all" || overview === undefined) return null;
  if (calendar !== null) {
    // The days of the period before this one are not the ones kept while the new ones load.
    if (second.data === undefined || second.isPlaceholderData) return null;
    const modes = second.data.modes;
    return {
      name: comparisonName(period, calendar, format),
      totals: second.data.totals,
      modeDistanceM: (mode) => modes.find((entry) => entry.mode === mode)?.distanceM ?? 0,
      empty: second.data.totals.moves + second.data.totals.stops === 0,
    };
  }
  const { previous } = overview;
  return {
    name: daysBefore(overview.period.days),
    totals: previous.totals,
    modeDistanceM: (mode) => {
      const entry = overview.modes.find((candidate) => candidate.mode === mode);
      return entry === undefined ? 0 : Math.max(0, entry.distanceM - entry.deltaDistanceM);
    },
    empty: previous.totals.moves + previous.totals.stops === 0,
  };
}
