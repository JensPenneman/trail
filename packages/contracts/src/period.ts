/*
 * The period of a request in local days, shared by the operations that take one: Insights, the
 * heatmap of time and visits and the People page's address (docs/architecture.md §8.7). Small, so
 * that none of them pulls the other's contract.
 */

/** A request covers at most this many years. */
export const insightsMaxYears = 3;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The last local day a period that starts on `from` may end on: the day before
 * the same date `insightsMaxYears` later (29 February moves to 1 March).
 */
export function lastInsightsDay(from: string): string {
  const [year = 0, month = 1, day = 1] = from.split("-").map(Number);
  const end = new Date(Date.UTC(year + insightsMaxYears, month - 1, day - 1));
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
}

export const spanMessage = `The period can span at most ${insightsMaxYears} years`;

export interface PeriodQuery {
  from?: string | undefined;
  to?: string | undefined;
}

export const ordered = (query: PeriodQuery): boolean =>
  query.from === undefined || query.to === undefined || query.to >= query.from;
export const withinSpan = (query: PeriodQuery): boolean =>
  query.from === undefined || query.to === undefined || query.to <= lastInsightsDay(query.from);
