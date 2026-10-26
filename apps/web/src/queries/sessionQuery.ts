import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";
import { fetchSession } from "./fetchSession";
import { sessionEndedOnPurpose } from "./sessionEndedOnPurpose";

/** Shared by the route guard and the start-up prefetch. `data` is null when signed out. */
export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: async ({ client, signal }) => {
    const user = await fetchSession(signal);
    if (user !== null) sessionEndedOnPurpose.sessionFound(client);
    return user;
  },
  staleTime: 5 * 60_000,
});
