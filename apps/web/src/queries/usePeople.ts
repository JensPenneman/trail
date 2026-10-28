import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { peopleResponseSchema } from "@trail/contracts/person";
import { queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";

/**
 * People who share their location with the signed-in person, as their shares
 * allow. Memory only, never on disk; asked for again with the answer's ETag.
 */
export function usePeople() {
  return useQuery({
    queryKey: queryKeys.people,
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.v1.people.root, peopleResponseSchema),
    select: (response) => response.people,
  });
}
