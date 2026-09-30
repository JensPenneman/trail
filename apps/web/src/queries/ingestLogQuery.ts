import { queryOptions } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { ingestLogResponseSchema } from "@trail/contracts/ingestLog";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Most recent accepted uploads of a device, newest first. Refetched on every `ingest` event. */
export function ingestLogQuery(deviceId: string, limit: number) {
  return queryOptions({
    queryKey: queryKeys.ingestLog(deviceId, limit),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.devices.ingestLog(deviceId), ingestLogResponseSchema, {
        query: { limit },
        signal,
      }),
  });
}
