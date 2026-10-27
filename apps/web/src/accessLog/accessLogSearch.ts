import {
  type DataAccessActorKind,
  type DataAccessChannel,
  dataAccessActionSchema,
  dataAccessActorKinds,
  dataAccessChannels,
} from "@trail/contracts/dataAccess";
import type { AccessLogParams } from "../api/queryKeys";
import { periodStart } from "./viewerDays";

/*
 * The filters of Settings › Access log, which are its address
 * (`?actor=person&channel=people&days=7&action=getPersonTrack`): whose
 * accesses, through which channel, how far back and which action. Every
 * filter changes its own parameter only; one that is not understood is left
 * out, as if it were not there.
 */

/** How far back: today, or the last 7, 30 or 90 local days with today. Without one, everything kept. */
export const accessLogDays = [1, 7, 30, 90] as const;
type AccessLogDays = (typeof accessLogDays)[number];

export interface AccessLogSearch {
  /** One kind of actor; null for everyone (yourself only when your own activity is shown). */
  actor: DataAccessActorKind | null;
  channel: DataAccessChannel | null;
  days: AccessLogDays | null;
  action: string | null;
}

const isActorKind = (value: string | null): value is DataAccessActorKind =>
  value !== null && (dataAccessActorKinds as readonly string[]).includes(value);

const isChannel = (value: string | null): value is DataAccessChannel =>
  value !== null && (dataAccessChannels as readonly string[]).includes(value);

function daysOf(value: string | null): AccessLogDays | null {
  const days = Number(value);
  return (accessLogDays as readonly number[]).includes(days) ? (days as AccessLogDays) : null;
}

export function parseAccessLogSearch(params: URLSearchParams): AccessLogSearch {
  const actor = params.get("actor");
  const channel = params.get("channel");
  const action = params.get("action");
  return {
    actor: isActorKind(actor) ? actor : null,
    channel: isChannel(channel) ? channel : null,
    days: daysOf(params.get("days")),
    action: action !== null && dataAccessActionSchema.safeParse(action).success ? action : null,
  };
}

/** `params` with the filters of `change`; null takes a filter away. Other parameters stay. */
export function withAccessLogFilter(
  params: URLSearchParams,
  change: Partial<AccessLogSearch>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(change)) {
    if (value === null || value === undefined) next.delete(key);
    else next.set(key, String(value));
  }
  return next;
}

/** Whether any filter is set, so the page can offer to clear them. */
export const isFiltered = (search: AccessLogSearch): boolean =>
  search.actor !== null ||
  search.channel !== null ||
  search.days !== null ||
  search.action !== null;

/** Everyone but yourself: what the log shows while your own activity is hidden. */
const others: readonly DataAccessActorKind[] = ["person", "link", "token"];

/** The filters as the page shows them: yourself and your browser only while your activity is. */
export function shownSearch(search: AccessLogSearch, showOwn: boolean): AccessLogSearch {
  if (showOwn) return search;
  return {
    ...search,
    actor: search.actor === "owner" ? null : search.actor,
    channel: search.channel === "web" ? null : search.channel,
  };
}

/**
 * The request for the filters: your own sessions left out unless they are
 * shown (`showOwnActivity`), and a filter for them dropped while they are
 * not; the period from the start of its first local day.
 */
export function accessLogParams(
  search: AccessLogSearch,
  context: { showOwn: boolean; today: string; timeZone: string },
): AccessLogParams {
  const shown = shownSearch(search, context.showOwn);
  return {
    actor: shown.actor !== null ? [shown.actor] : context.showOwn ? null : others,
    channel: shown.channel === null ? null : [shown.channel],
    action: shown.action,
    from: shown.days === null ? null : periodStart(context.today, shown.days, context.timeZone),
    actorId: null,
  };
}
