import { queryOptions } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { ingestLogResponseSchema } from "@trail/contracts/ingestLog";
import { queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";

/** Most recent accepted uploads of a device, newest first. Refetched on every `ingest` event. */
export function ingestLogQuery(deviceId: string, limit: number) {
  return queryOptions({
    queryKey: queryKeys.ingestLog(deviceId, limit),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch(
        { client, queryKey, signal },
        apiPaths.devices.ingestLog(deviceId),
        ingestLogResponseSchema,
        { query: { limit } },
      ),
  });
}
