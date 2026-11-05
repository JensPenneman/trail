import { useMemo } from "react";
import { useLocation, useSearchParams } from "react-router";
import type { InsightsParams } from "../../api/queryKeys";
import { useToday } from "../../time/useToday";
import {
  type InsightsAddress,
  type InsightsPeriod,
  insightsParams,
  type PeriodUnit,
  parseInsightsAddress,
  periodInUnit,
  periodRange,
  stepPeriod,
  withDevices,
  withPeriod,
} from "./insightsPeriod";

export interface InsightsPeriodState extends InsightsAddress {
  /** The address's parameters, for links that keep them. */
  params: URLSearchParams;
  today: string;
  /** The local days asked for; `from` null: from the first day with data. */
  range: { from: string | null; to: string };
  /** The request of a screen; a screen of a mode adds the mode itself. */
  query: () => InsightsParams;
  /** Another unit around the same day (a step back can undo it). */
  chooseUnit: (unit: PeriodUnit) => void;
  /** A custom range of days (a step back can undo it). */
  chooseRange: (from: string, to: string) => void;
  /** The period before or after; null where there is none. */
  step: (direction: -1 | 1) => void;
  /** The period before or after, to tell whether there is one. */
  neighbour: (direction: -1 | 1) => InsightsPeriod | null;
  chooseDevices: (devices: readonly string[] | null) => void;
}

/**
 * The Insights screens' state, which is their address: every control changes
 * its own parameter only, so a period chosen on one screen holds on the others.
 * A new unit or range is a step back can undo; steps and device toggles replace
 * the entry (keeping where it was opened from, see openedFrom).
 */
export function useInsightsPeriod(): InsightsPeriodState {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const today = useToday();
  const address = useMemo(() => parseInsightsAddress(params, today), [params, today]);
  const { period } = address;
  const replace = { replace: true, state } as const;
  return {
    ...address,
    params,
    today,
    range: periodRange(period, today),
    query: () => insightsParams(address, today),
    chooseUnit: (unit) =>
      setParams((current) => withPeriod(current, periodInUnit(period, unit, today))),
    chooseRange: (first, last) =>
      setParams((current) => withPeriod(current, { kind: "custom", first, last })),
    step: (direction) => {
      const next = stepPeriod(period, direction, today);
      if (next !== null) setParams((current) => withPeriod(current, next), replace);
    },
    neighbour: (direction) => stepPeriod(period, direction, today),
    chooseDevices: (devices) => setParams((current) => withDevices(current, devices), replace),
  };
}
