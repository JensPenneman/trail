import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type SessionUser,
  sessionResponseSchema,
  type UpdateMeRequest,
} from "@trail/contracts/user";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Display name and time zone. A new zone moves every day boundary, so day-based data is refetched. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeRequest) =>
      apiFetch(apiPaths.me.root, sessionResponseSchema, { method: "PATCH", body }),
    onSuccess: ({ user }) => {
      const previous = queryClient.getQueryData<SessionUser | null>(queryKeys.session);
      queryClient.setQueryData(queryKeys.session, user);
      if (previous?.timezone !== user.timezone) {
        for (const queryKey of [
          queryKeys.devices,
          queryKeys.all.days,
          queryKeys.all.tracks,
          queryKeys.all.visits,
          queryKeys.all.trips,
        ]) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
    },
  });
}
