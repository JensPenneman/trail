import { onlineManager, type QueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { ApiError } from "../api/ApiError";
import { apiFetch } from "../api/apiFetch";
import { readApiAnswer } from "../api/readApiAnswer";
import { readApiError } from "../api/readApiError";
import { type ApiRequest, sendApiRequest } from "../api/sendApiRequest";
import { browserCacheOf } from "./attachBrowserCache";
import { policyOf } from "./cachePolicy";
import { cacheValidators } from "./cacheValidators";
import { settleDay } from "./settledDay";

/** The query function context a revalidation needs: whose cache, which query. */
export interface CachedFetchContext {
  client: QueryClient;
  queryKey: readonly unknown[];
  signal: AbortSignal;
}

/** The server's new answer, or word that the one on screen still holds (`304`, or matching stamps). */
export type Revalidation<T> = { changed: true; answer: T } | { changed: false };

const offline = () =>
  new ApiError({
    status: 0,
    code: "network",
    message: "You’re offline. Trail asks again when you reconnect.",
  });

/**
 * Asks for an answer the way the copy can save the server work (docs/
 * architecture.md §14): a past day on screen whose stamps the calendar's
 * digest still has is current without a request; otherwise, with an answer
 * on screen and its ETag, `If-None-Match`, where a `304` means the answer on
 * screen holds — the stored body, with a new `fetchedAt`. Nothing is asked
 * while the browser is offline: the query's retries wait for the network.
 * A `304` it did not ask for is `invalid_response`, as for `apiFetch`.
 */
export async function revalidate<T>(
  context: CachedFetchContext,
  path: string,
  schema: z.ZodType<T>,
  request: Omit<ApiRequest, "signal"> = {},
): Promise<Revalidation<T>> {
  const { client, queryKey, signal } = context;
  const policy = policyOf(queryKey);
  const stats = browserCacheOf(client)?.stats;
  const shown = client.getQueryData(queryKey);
  if (shown !== undefined && policy?.validate === "stamps") {
    if (await settleDay(client, queryKey, shown)) {
      stats?.add("hits");
      return { changed: false };
    }
  }
  if (!onlineManager.isOnline()) throw offline();
  const etag =
    shown !== undefined && policy !== null && policy.validate !== "none"
      ? cacheValidators.get(client, queryKey)
      : null;
  const response = await sendApiRequest(path, {
    ...request,
    signal,
    ...(etag === null ? {} : { headers: { ...request.headers, "If-None-Match": etag } }),
  });
  if (etag !== null) stats?.add("revalidations");
  if (response.status === 304) {
    if (etag === null) {
      throw new ApiError({
        status: 304,
        code: "invalid_response",
        message: "The server answered in a format this version of Trail does not understand.",
      });
    }
    stats?.add("notModified");
    return { changed: false };
  }
  if (!response.ok) throw await readApiError(response);
  const answer = await readApiAnswer(response, schema);
  cacheValidators.set(client, queryKey, response.headers.get("ETag"));
  return { changed: true, answer };
}

/**
 * `apiFetch` for the queries the copy keeps: the answer, or the one on screen
 * when the server or the stamps say it still holds.
 */
export async function cachedFetch<T>(
  context: CachedFetchContext,
  path: string,
  schema: z.ZodType<T>,
  request: Omit<ApiRequest, "signal"> = {},
): Promise<T> {
  const result = await revalidate(context, path, schema, request);
  if (result.changed) return result.answer;
  const shown = context.client.getQueryData<T>(context.queryKey);
  if (shown !== undefined) return shown;
  // The answer left memory while the server confirmed it: ask for it again, whole.
  return apiFetch(path, schema, { ...request, signal: context.signal });
}
