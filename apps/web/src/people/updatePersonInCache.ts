import type { QueryClient } from "@tanstack/react-query";
import type { PeopleResponse, SharedDevice } from "@trail/contracts/person";
import { queryKeys } from "../api/queryKeys";

/**
 * Folds a `person` event into the people list: the device is replaced (or
 * added) for that person. Someone the list does not know yet — they just
 * started sharing — makes it refetch instead.
 */
export function updatePersonInCache(
  queryClient: QueryClient,
  userId: string,
  device: SharedDevice,
): void {
  const cached = queryClient.getQueryData<PeopleResponse>(queryKeys.people);
  if (cached === undefined) return;
  if (!cached.people.some((person) => person.userId === userId)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.people });
    return;
  }
  queryClient.setQueryData<PeopleResponse>(queryKeys.people, {
    people: cached.people.map((person) =>
      person.userId !== userId
        ? person
        : {
            ...person,
            devices: person.devices.some((entry) => entry.id === device.id)
              ? person.devices.map((entry) => (entry.id === device.id ? device : entry))
              : [...person.devices, device],
          },
    ),
  });
}
