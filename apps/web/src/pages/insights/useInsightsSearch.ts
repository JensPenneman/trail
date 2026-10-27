import type { TransportMode } from "@trail/contracts/transport";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import type { InsightsParams } from "../../api/queryKeys";
import { useToday } from "../../time/useToday";
import {
  type InsightsSearch,
  insightsParams,
  type insightsPeriods,
  insightsRange,
  parseInsightsSearch,
  withDevices,
  withMode,
  withPeriod,
} from "./insightsSearch";

export interface InsightsSearchState {
  search: InsightsSearch;
  /** The address's parameters, for links that keep them. */
  params: URLSearchParams;
  today: string;
  /** The local days asked for; `from` null: from the first day with data. */
  range: { from: string | null; to: string };
  /** The request of a page; `withMode` for the pages that filter by a mode. */
  query: (withMode?: boolean) => InsightsParams;
  choosePeriod: (
    choice: { period: (typeof insightsPeriods)[number] } | { from: string; to: string },
  ) => void;
  chooseDevices: (devices: readonly string[] | null) => void;
  chooseMode: (mode: TransportMode | null) => void;
}

/**
 * The Insights pages' state, which is their address: every control changes
 * its own parameter only, so a period chosen on one page holds on the others.
 * A new period or mode is a step back can undo; device toggles replace it.
 */
export function useInsightsSearch(): InsightsSearchState {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const search = useMemo(() => parseInsightsSearch(params), [params]);
  return {
    search,
    params,
    today,
    range: insightsRange(search, today),
    query: (filtered = false) => insightsParams(search, today, filtered),
    choosePeriod: (choice) => setParams((current) => withPeriod(current, choice)),
    chooseDevices: (devices) =>
      setParams((current) => withDevices(current, devices), { replace: true }),
    chooseMode: (mode) => setParams((current) => withMode(current, mode)),
  };
}
