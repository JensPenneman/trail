import { accessSummaryPeriods } from "@trail/contracts/dataAccess";
import { useSearchParams } from "react-router";
import type { AccessSummaryParams } from "../api/queryKeys";
import { addDays } from "../time/addDays";
import { startOfLocalDay } from "../time/startOfLocalDay";

export type ViewerDays = AccessSummaryParams["days"];

/** The periods of Who viewed you, as the summary has them. */
export const viewerDays: readonly ViewerDays[] = accessSummaryPeriods.map(
  (value) => Number(value) as ViewerDays,
);

/** Without a choice in the address: the last 30 days. */
const defaultDays: ViewerDays = 30;

/** The period an address asks for (`?days=7`); anything else is the default. */
export function parseViewerDays(params: URLSearchParams): ViewerDays {
  const days = Number(params.get("days"));
  return (viewerDays as readonly number[]).includes(days) ? (days as ViewerDays) : defaultDays;
}

/**
 * The period of Who viewed you and of an actor's page, which is their
 * address: choosing one is a step Back undoes, and it holds from the list to
 * an actor's page and back.
 */
export function useViewerDays(): [ViewerDays, (days: ViewerDays) => void, URLSearchParams] {
  const [params, setParams] = useSearchParams();
  const choose = (days: ViewerDays) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (days === defaultDays) next.delete("days");
      else next.set("days", String(days));
      return next;
    });
  return [parseViewerDays(params), choose, params];
}

/** "the last 7 days". */
export const daysPhrase = (days: number): string => `the last ${days} days`;

/** The period of the usage sections of a token's, a link's and a share's page. */
export const usageDays: ViewerDays = 30;

const hourMs = 3_600_000;

/**
 * Where the lines of a period of local days begin (`from` of the log): the
 * first hour that starts on its first day. The log counts whole UTC hours,
 * each on the local day it starts in, like the summary; so in a zone half an
 * hour off UTC the hour around midnight belongs to the day before.
 */
export function periodStart(today: string, days: number, timeZone: string): string {
  const start = startOfLocalDay(addDays(today, -(days - 1)), timeZone);
  return new Date(Math.ceil(start / hourMs) * hourMs).toISOString();
}
