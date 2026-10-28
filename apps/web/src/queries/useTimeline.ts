import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type Segment,
  type TimelineResponse,
  timelineResponseSchema,
} from "@trail/contracts/transport";
import { apiFetch } from "../api/apiFetch";
import { queryKeys, type RangeParams } from "../api/queryKeys";
import { revalidate } from "../cache/cachedFetch";
import { dayQueryOptions } from "../cache/dayQueryOptions";
import type { TimelineAnswer } from "./timelineAnswer";

/** Pages are read until the end: a day or a short period holds a few hundred segments at most. */
const pageLimit = 1000;
const maxPages = 20;

/**
 * The stops and moves in `[from, to)` (`/api/v1/segments`), every page. The
 * first page revalidates the answer on screen: its ETag and the stamps cover
 * the whole range, so a `304` (or matching stamps) keeps every page.
 */
export function useTimeline(params: RangeParams | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: params === null ? queryKeys.all.timeline : queryKeys.timeline(params),
    queryFn: async ({ client, queryKey, signal }): Promise<TimelineAnswer> => {
      if (params === null) return { items: [], pending: false };
      const page = (cursor: string | null) => ({
        query: {
          from: params.from,
          to: params.to,
          devices: params.deviceIds,
          limit: pageLimit,
          cursor,
        },
      });
      const first = await revalidate(
        { client, queryKey, signal },
        apiPaths.v1.segments.root,
        timelineResponseSchema,
        page(null),
      );
      const shown = client.getQueryData<TimelineAnswer>(queryKey);
      if (!first.changed && shown !== undefined) return shown;
      let response: TimelineResponse = first.changed
        ? first.answer
        : await apiFetch(apiPaths.v1.segments.root, timelineResponseSchema, {
            ...page(null),
            signal,
          });
      const items: Segment[] = [...response.items];
      let pending = response.pending;
      const stamps = response.stamps;
      for (let count = 1; count < maxPages && response.nextCursor !== null; count += 1) {
        response = await apiFetch(apiPaths.v1.segments.root, timelineResponseSchema, {
          ...page(response.nextCursor),
          signal,
        });
        items.push(...response.items);
        pending = pending || response.pending;
      }
      return stamps === undefined ? { items, pending } : { items, pending, stamps };
    },
    enabled: params !== null,
    ...dayQueryOptions(queryClient, "timeline", params),
  });
}
