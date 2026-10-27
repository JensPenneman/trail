/** Whether a location's state says it was opened from `path` (a row passes it, see SettingsRow). */
export function openedFrom(state: unknown, path: string): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "settingsFrom" in state &&
    state.settingsFrom === path
  );
}
