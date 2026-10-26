import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type Segment,
  type TimelineResponse,
  timelineResponseSchema,
} from "@trail/contracts/transport";
import { apiFetch } from "../api/apiFetch";
import { queryKeys, type RangeParams } from "../api/queryKeys";

/** Pages are read until the end: a day or a short period holds a few hundred segments at most. */
const pageLimit = 1000;
const maxPages = 20;

/** The stops and moves in `[from, to)` (`/api/v1/segments`), every page. */
export function useTimeline(params: RangeParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.timeline : queryKeys.timeline(params),
    queryFn: async ({ signal }) => {
      if (params === null) return { items: [] as Segment[], pending: false };
      const items: Segment[] = [];
      let cursor: string | null = null;
      let pending = false;
      for (let page = 0; page < maxPages; page += 1) {
        const response: TimelineResponse = await apiFetch(
          apiPaths.v1.segments.root,
          timelineResponseSchema,
          {
            query: {
              from: params.from,
              to: params.to,
              devices: params.deviceIds,
              limit: pageLimit,
              cursor,
            },
            signal,
          },
        );
        items.push(...response.items);
        pending = pending || response.pending;
        cursor = response.nextCursor;
        if (cursor === null) break;
      }
      return { items, pending };
    },
    enabled: params !== null,
  });
}
