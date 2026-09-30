import { queryOptions } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { publicConfigSchema } from "@trail/contracts/config";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Public runtime configuration: thresholds, map styles, ingest URL and build info. */
export const configQuery = queryOptions({
  queryKey: queryKeys.config,
  queryFn: ({ signal }) => apiFetch(apiPaths.config, publicConfigSchema, { signal }),
  staleTime: 60 * 60_000,
});
