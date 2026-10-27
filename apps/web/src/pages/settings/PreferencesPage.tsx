import type { Preferences } from "@trail/contracts/preferences";
import { processingLevels } from "@trail/contracts/transport";
import { useState } from "react";
import { useSessionUser } from "../../app/useSessionUser";
import { isMapStyleChoice, mapStyleChoices, mapStyleLabels } from "../../map/mapStyleChoices";
import { useConfig } from "../../queries/useConfig";
import { useUpdatePreferences } from "../../queries/useUpdatePreferences";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { levelLabels } from "../../transport/LevelControl";
import { ErrorState } from "../../ui/ErrorState";
import { useAnnounce } from "../../ui/useAnnounce";

const isLevel = (value: string): value is (typeof processingLevels)[number] =>
  (processingLevels as readonly string[]).includes(value);

/** What is said once a change is saved. */
function savedText(change: Partial<Preferences>): string {
  if (change.mapStyle !== undefined) return `Map style saved: ${mapStyleLabels[change.mapStyle]}.`;
  if (change.level !== undefined)
    return `Detail of the tracks saved: ${levelLabels[change.level]}.`;
  return change.showOwnActivity === true
    ? "The access log lists your own activity too."
    : "The access log leaves your own activity out.";
}

/** `pending` without the values `change` set, once it is saved or refused (a newer one stays). */
function settled(
  pending: Partial<Preferences>,
  change: Partial<Preferences>,
): Partial<Preferences> {
  const next = { ...pending };
  if (change.mapStyle !== undefined && next.mapStyle === change.mapStyle) delete next.mapStyle;
  if (change.level !== undefined && next.level === change.level) delete next.level;
  if (change.showOwnActivity !== undefined && next.showOwnActivity === change.showOwnActivity) {
    delete next.showOwnActivity;
  }
  return next;
}

/**
 * Settings › Preferences: defaults the account takes to every browser, saved
 * the moment they change. A link that names a style or level, and a choice
 * made on the map on a browser, still win there; saving one here makes this
 * browser follow it again.
 */
export function PreferencesPage() {
  const session = useSessionUser();
  const config = useConfig();
  const announce = useAnnounce();
  // Shown the moment a control changes, before the session follows (a switch must not flick back).
  const [pending, setPending] = useState<Partial<Preferences>>({});
  const update = useUpdatePreferences({
    onSaved: (change) => announce(savedText(change)),
    onSettled: (change) => setPending((current) => settled(current, change)),
  });
  const preferences: Preferences = { ...session.preferences, ...pending };
  const save = (change: Partial<Preferences>) => {
    setPending((current) => ({ ...current, ...change }));
    update.mutate(change);
  };
  // Satellite only where the server has imagery (or where it was chosen before it went).
  const styles = mapStyleChoices.filter(
    (style) =>
      style !== "satellite" ||
      config.data?.mapStyles.satellite !== undefined ||
      session.preferences.mapStyle === "satellite",
  );
  return (
    <SettingsPage page="preferences">
      {update.isError ? (
        <ErrorState title="That preference was not saved" error={update.error} />
      ) : null}
      <SettingsGroup
        title="Map"
        id="map"
        footer="Where neither the address nor a choice on the map on that browser says otherwise. Choosing here also makes this browser follow it again."
      >
        <SettingsRow
          kind="select"
          icon="map"
          tone="blue"
          label="Map style"
          detail="Auto is light or dark, as the system is set."
          selected={preferences.mapStyle}
          options={styles.map((style) => ({ value: style, label: mapStyleLabels[style] }))}
          onChange={(value) => {
            if (isMapStyleChoice(value)) save({ mapStyle: value });
          }}
        />
        <SettingsRow
          kind="select"
          icon="layers"
          tone="purple"
          label="Detail of the tracks"
          detail="From the points as recorded to stops and moves by how you travelled."
          selected={preferences.level}
          options={processingLevels.map((level) => ({ value: level, label: levelLabels[level] }))}
          onChange={(value) => {
            if (isLevel(value)) save({ level: value });
          }}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Access log"
        id="access-log"
        footer="The access log comes with a later version of Trail; this choice is kept for it."
      >
        <SettingsRow
          kind="switch"
          icon="history"
          tone="gray"
          label="Your own activity"
          detail="Also list what you did yourself, not only what others did with your data."
          checked={preferences.showOwnActivity}
          onChange={(checked) => save({ showOwnActivity: checked })}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
