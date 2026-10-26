import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { peopleResponseSchema } from "@trail/contracts/person";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** People who share their location with the signed-in person, as their shares allow. */
export function usePeople() {
  return useQuery({
    queryKey: queryKeys.people,
    queryFn: ({ signal }) => apiFetch(apiPaths.v1.people.root, peopleResponseSchema, { signal }),
    select: (response) => response.people,
  });
}
