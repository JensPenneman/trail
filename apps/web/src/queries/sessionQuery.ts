import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";
import { fetchSession } from "./fetchSession";

/** Shared by the route guard and the start-up prefetch. `data` is null when signed out. */
export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: ({ signal }) => fetchSession(signal),
  staleTime: 5 * 60_000,
});
