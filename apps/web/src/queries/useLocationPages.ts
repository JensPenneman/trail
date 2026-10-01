import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { locationsPageSchema } from "@trail/contracts/location";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { goneDevices } from "../devices/goneDevices";

const pageSize = 25;

/** Raw stored points of one device, newest first, one page per "Load older" press. */
export function useLocationPages(deviceId: string) {
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    enabled: () => !goneDevices.has(queryClient, deviceId),
    queryKey: queryKeys.locations(deviceId),
    queryFn: ({ pageParam, signal }) =>
      apiFetch(apiPaths.locations, locationsPageSchema, {
        query: { deviceId, limit: pageSize, before: pageParam },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
