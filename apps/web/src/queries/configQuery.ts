import { queryOptions } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { publicConfigSchema } from "@trail/contracts/config";
import { queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/** Public runtime configuration: thresholds, map styles, ingest URL and build info. */
export const configQuery = queryOptions({
  queryKey: queryKeys.config,
  queryFn: ({ client, queryKey, signal }) =>
    cachedFetch({ client, queryKey, signal }, apiPaths.config, publicConfigSchema),
  staleTime: freshFor("config"),
});
