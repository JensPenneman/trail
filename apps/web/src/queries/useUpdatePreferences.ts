import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { Preferences } from "@trail/contracts/preferences";
import { type SessionUser, sessionResponseSchema } from "@trail/contracts/user";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { forgetMapStyleChoice } from "../map/useMapStyle";
import { forgetTrackLevelChoice } from "../transport/useTrackLevel";

interface UpdatePreferencesCallbacks {
  /** After each change is saved (every one, not only the last of several in a row). */
  onSaved?: (change: Partial<Preferences>) => void;
  /** After each change is saved or refused. */
  onSettled?: (change: Partial<Preferences>) => void;
}

/**
 * Changes some of the account's preferences (`PATCH /api/me`). The session
 * shows the change at once — the map follows it before the answer — and goes
 * back if it fails. Changes are sent one after another (the scope), so the
 * last answer carries all of them. A saved map style or level is no longer
 * this browser's own choice: the browser follows the account again.
 */
export function useUpdatePreferences({ onSaved, onSettled }: UpdatePreferencesCallbacks = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preferences: Partial<Preferences>) =>
      apiFetch(apiPaths.me.root, sessionResponseSchema, {
        method: "PATCH",
        body: { preferences },
      }),
    scope: { id: "me" },
    onMutate: async (preferences) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.session });
      const previous = queryClient.getQueryData<SessionUser | null>(queryKeys.session);
      if (previous !== undefined && previous !== null) {
        queryClient.setQueryData<SessionUser>(queryKeys.session, {
          ...previous,
          preferences: { ...previous.preferences, ...preferences },
        });
      }
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.session, context.previous);
      }
    },
    onSuccess: ({ user }, preferences) => {
      queryClient.setQueryData(queryKeys.session, user);
      if (preferences.mapStyle !== undefined) forgetMapStyleChoice();
      if (preferences.level !== undefined) forgetTrackLevelChoice();
      onSaved?.(preferences);
    },
    onSettled: (_answer, _error, preferences) => onSettled?.(preferences),
  });
}
