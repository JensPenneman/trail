import { useState } from "react";
import { useSessionUser } from "../app/useSessionUser";
import { useUpdatePreferences } from "../queries/useUpdatePreferences";
import { useAnnounce } from "../ui/useAnnounce";

export interface OwnActivity {
  /** Whether the pages count what the person did themselves, signed in. */
  showOwn: boolean;
  /** Shows or hides it, and keeps that as the account's preference. */
  setShowOwn: (show: boolean) => void;
  /** Why the last change was not saved. */
  error: unknown;
}

/**
 * The `showOwnActivity` preference, as Who viewed you and the access log use
 * it: the account's choice, which the switch on those pages changes and
 * saves like the one in Preferences. A change shows at once, before the
 * answer, and goes back if it fails.
 */
export function useOwnActivity(): OwnActivity {
  const session = useSessionUser();
  const announce = useAnnounce();
  // Shown the moment the switch changes, before the session follows (it must not flick back).
  const [pending, setPending] = useState<boolean | null>(null);
  const update = useUpdatePreferences({
    onSaved: (change) =>
      announce(
        change.showOwnActivity === true
          ? "Your own activity is shown too."
          : "Your own activity is left out.",
      ),
    onSettled: (change) =>
      setPending((current) => (current === change.showOwnActivity ? null : current)),
  });
  return {
    showOwn: pending ?? session.preferences.showOwnActivity,
    setShowOwn: (show) => {
      setPending(show);
      update.mutate({ showOwnActivity: show });
    },
    error: update.isError ? update.error : null,
  };
}
