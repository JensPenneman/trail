import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";
import { browserCacheOf } from "../cache/attachBrowserCache";
import { fetchSession } from "./fetchSession";
import { sessionEndedOnPurpose } from "./sessionEndedOnPurpose";

/**
 * Shared by the route guard and the start-up prefetch. `data` is null when
 * signed out. It gates every paint of personal data: the copy on disk is bound
 * to the person it names (another person's copy is emptied first) and the
 * warm set goes into the cache before the answer reaches the route guard.
 */
export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: async ({ client, signal }) => {
    const user = await fetchSession(signal);
    if (user !== null) {
      sessionEndedOnPurpose.sessionFound(client);
      await browserCacheOf(client)?.signedIn(user);
    }
    return user;
  },
  staleTime: 5 * 60_000,
});
