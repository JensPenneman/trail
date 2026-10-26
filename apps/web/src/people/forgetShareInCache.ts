import type { QueryClient } from "@tanstack/react-query";
import type { PeopleResponse } from "@trail/contracts/person";
import { queryKeys } from "../api/queryKeys";

/** A stopped share: its person leaves the list at once, before the refetch confirms it. */
export function forgetShareInCache(queryClient: QueryClient, shareId: string): void {
  const cached = queryClient.getQueryData<PeopleResponse>(queryKeys.people);
  if (cached === undefined) return;
  queryClient.setQueryData<PeopleResponse>(queryKeys.people, {
    people: cached.people.filter((person) => person.share.id !== shareId),
  });
}
