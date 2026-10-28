import type { Query, QueryClient } from "@tanstack/react-query";
import type { CacheStamp } from "@trail/contracts/cacheStamp";
import type { DaysResponse } from "@trail/contracts/stats";
import type { SessionUser } from "@trail/contracts/user";
import { queryKeys } from "../api/queryKeys";
import { devicesOf, periodOf } from "./cachePeriod";
import { freshFor, policyOf, stampsCompared, stampsOf } from "./cachePolicy";
import { stampPlace, stampsMatch } from "./stampsMatch";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDaysResponse = (value: unknown): value is DaysResponse =>
  isRecord(value) && Array.isArray(value["days"]) && typeof value["timezone"] === "string";

/** What a settled day is checked against: a past local day of some devices, and its stamps. */
interface Question {
  date: string;
  deviceIds: readonly string[] | null;
  timezone: string;
  stamps: Parameters<typeof stampsMatch>[0];
  compare: "raw" | "both";
}

/**
 * The question a query key and its answer ask of the digest, or null when
 * they ask none: only a past local day of a resource that validates with
 * stamps, answered with stamps, while a session says which zone days are in.
 * Ranges and today revalidate with their ETag.
 */
function questionOf(
  client: QueryClient,
  queryKey: readonly unknown[],
  answer: unknown,
  now: number,
): Question | null {
  const policy = policyOf(queryKey);
  const compare = stampsCompared(queryKey);
  if (policy === null || policy.validate !== "stamps" || compare === null) return null;
  const timezone = client.getQueryData<SessionUser | null>(queryKeys.session)?.timezone;
  if (timezone === undefined) return null;
  const period = periodOf(queryKey, timezone);
  if (period === null || period.day === null || period.until > now) return null;
  const stamps = stampsOf(answer);
  if (stamps === undefined || stamps.length === 0) return null;
  return { date: period.day, deviceIds: devicesOf(queryKey), timezone, stamps, compare };
}

/** Whether a `days` query may vouch for the day and devices asked about, now or once it came. */
function covers(digest: Query, question: Question): boolean {
  const params = digest.queryKey[1];
  if (!isRecord(params)) return false;
  const { from, to, deviceIds } = params;
  if (typeof from !== "string" || typeof to !== "string") return false;
  if (from > question.date || to < question.date) return false;
  if (deviceIds !== null) {
    if (!Array.isArray(deviceIds) || question.deviceIds === null) return false;
    if (!question.deviceIds.every((id) => deviceIds.includes(id))) return false;
  }
  const data = digest.state.data;
  if (data === undefined) return digest.state.fetchStatus === "fetching";
  return isDaysResponse(data) && data.timezone === question.timezone;
}

const isFresh = (digest: Query, now: number): boolean =>
  digest.state.data !== undefined &&
  !digest.state.isInvalidated &&
  now - digest.state.dataUpdatedAt <= freshFor("days");

/** Whether a fresh digest's rows for the day are the answer's stamps. */
function matches(digest: Query, question: Question): boolean {
  if (!isDaysResponse(digest.state.data)) return false;
  const rows = new Map<string, CacheStamp | undefined>();
  for (const row of digest.state.data.days) {
    if (row.date !== question.date) continue;
    if (question.deviceIds !== null && !question.deviceIds.includes(row.deviceId)) continue;
    rows.set(stampPlace(row.deviceId, row.date), row.stamp);
  }
  return stampsMatch(question.stamps, rows, question.compare);
}

const digestsFor = (client: QueryClient, question: Question): Query[] =>
  client
    .getQueryCache()
    .findAll({ queryKey: queryKeys.all.days })
    .filter((digest) => covers(digest, question));

/** What the checks read of a query: its key and its answer. */
interface QueryLike {
  queryKey: readonly unknown[];
  state: { data: unknown };
}

/**
 * Whether a past day's answer is current without asking: a `days` answer
 * covering its date and devices is in memory and fresh (a minute; the `days`
 * event keeps it current in place), and its rows are the answer's stamps.
 * The `staleTime` of the day-sliced queries, which is infinite then.
 */
function isSettled(client: QueryClient, query: QueryLike, now = Date.now()): boolean {
  const question = questionOf(client, query.queryKey, query.state.data, now);
  if (question === null) return false;
  return digestsFor(client, question).some(
    (digest) => isFresh(digest, now) && matches(digest, question),
  );
}

/**
 * The same, for a query about to ask the server: a digest on its way is
 * waited for, and one gone stale while the page shows it (the calendar's) is
 * asked again first — one small request, usually a `304`, instead of the day
 * itself. Stepping back through History asks for nothing it saw before.
 */
export async function settleDay(
  client: QueryClient,
  queryKey: readonly unknown[],
  answer: unknown,
): Promise<boolean> {
  const question = questionOf(client, queryKey, answer, Date.now());
  if (question === null) return false;
  for (const digest of digestsFor(client, question)) {
    try {
      if (digest.state.fetchStatus === "fetching") await digest.promise;
      else if (!isFresh(digest, Date.now()) && digest.getObserversCount() > 0) await digest.fetch();
    } catch {
      continue;
    }
    if (isFresh(digest, Date.now()) && matches(digest, question)) return true;
  }
  return false;
}

/** `staleTime` of a day-sliced query: infinite while settled, else the resource's. */
export function settledStaleTime(client: QueryClient, resource: string) {
  return (query: QueryLike): number =>
    isSettled(client, query) ? Number.POSITIVE_INFINITY : freshFor(resource);
}
