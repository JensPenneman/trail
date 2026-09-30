import type { DeviceSummary } from "@trail/contracts/device";
import {
  type RemoteSettingsPreset,
  remoteSettingsPresetInfo,
  remoteSettingsPresets,
} from "@trail/contracts/remoteSettings";
import { useId, useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useUpdateDevice } from "../../queries/useUpdateDevice";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { Notice } from "../../ui/Notice";
import "./RemoteSettingsSection.css";

interface RemoteSettingsSectionProps {
  device: DeviceSummary;
}

/**
 * Overland accepts new settings in the server's reply to an upload. A preset
 * picked here is queued and delivered with the device's next upload.
 */
export function RemoteSettingsSection({ device }: RemoteSettingsSectionProps) {
  const format = useFormatter();
  const headingId = useId();
  const name = useId();
  const update = useUpdateDevice(device.id);
  // Nothing is preselected: Trail cannot know which settings the phone uses right now.
  const [choice, setChoice] = useState<RemoteSettingsPreset | null>(device.pendingSettings);
  const pending = device.pendingSettings;

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Tracking settings
        </h2>
        <p className="section__description">
          Change how Overland records, without touching the phone.
        </p>
      </div>
      <div className="card">
        {pending === null ? null : (
          <Notice
            tone="info"
            title={`“${remoteSettingsPresetInfo[pending].label}” is queued`}
            action={
              <Button
                variant="ghost"
                busy={update.isPending}
                onClick={() => update.mutate({ pendingSettings: null })}
              >
                Cancel
              </Button>
            }
          >
            <p>It is sent to the phone with its next upload.</p>
          </Notice>
        )}
        <fieldset className="presets">
          <legend className="visually-hidden">Preset</legend>
          {remoteSettingsPresets.map((preset) => (
            <label key={preset} className={choice === preset ? "preset is-chosen" : "preset"}>
              <input
                type="radio"
                name={name}
                value={preset}
                checked={choice === preset}
                onChange={() => setChoice(preset)}
              />
              <span className="preset__text">
                <span className="preset__label">{remoteSettingsPresetInfo[preset].label}</span>
                <span className="preset__description">
                  {remoteSettingsPresetInfo[preset].description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {update.isError ? (
          <ErrorState title="The preset was not saved" error={update.error} />
        ) : null}
        <div className="cluster presets__actions">
          <Button
            variant="primary"
            icon="upload"
            busy={update.isPending}
            disabled={choice === null || pending === choice}
            onClick={() => {
              if (choice !== null) update.mutate({ pendingSettings: choice });
            }}
          >
            Send with next upload
          </Button>
          <p className="muted presets__applied">
            {device.settingsAppliedAt === null
              ? "No preset has been sent to this phone yet."
              : `Last preset delivered ${format.dateTime(device.settingsAppliedAt)}.`}
          </p>
        </div>
      </div>
    </section>
  );
}
