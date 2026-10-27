import type { ChosenMode } from "@trail/contracts/transport";
import { useId, useState } from "react";
import { useDeviceMode } from "../queries/useDeviceMode";
import { useSetDeviceMode } from "../queries/useSetDeviceMode";
import { Dialog } from "../ui/Dialog";
import { errorMessage } from "../ui/errorMessage";
import { ModePicker } from "./ModePicker";
import { quickModes, transportModeInfo } from "./transportModes";
import "./QuickModeChips.css";

interface QuickModeChipsProps {
  deviceId: string;
  deviceName: string;
  /** Which device the chips set, and for how long, under them (the Me card's). */
  description?: string;
  /** The title of Other's dialog; "How is <device> travelling?" by default. */
  dialogTitle?: string;
}

/**
 * The quick toggle (docs/architecture.md §17.5), on the Me card for the
 * device that reported last and on each device's page: one tap says how you
 * travel from now on — until the next stop — and Auto hands it back to the
 * inference. "Other" opens every mode.
 */
export function QuickModeChips({
  deviceId,
  deviceName,
  description,
  dialogTitle,
}: QuickModeChipsProps) {
  const mode = useDeviceMode(deviceId);
  const set = useSetDeviceMode(deviceId);
  const descriptionId = useId();
  const [otherOpen, setOtherOpen] = useState(false);
  const chosen = mode.data?.override?.mode ?? null;
  const detected =
    mode.data?.current !== null && mode.data?.current !== undefined && !mode.data.current.setByUser
      ? mode.data.current.mode
      : null;
  const other = chosen !== null && !quickModes.includes(chosen);
  const pick = (next: ChosenMode | null) => {
    if (next === chosen) return;
    set.mutate(next);
  };
  const busy = set.isPending || mode.isPending;

  return (
    <div className="quick-modes">
      <fieldset
        className="quick-modes__chips"
        aria-describedby={description === undefined ? undefined : descriptionId}
      >
        <legend className="quick-modes__label">Now:</legend>
        {quickModes.map((option) => (
          <button
            key={option}
            type="button"
            className="quick-modes__chip"
            aria-pressed={chosen === option}
            disabled={busy}
            onClick={() => pick(option)}
          >
            {transportModeInfo[option].short}
          </button>
        ))}
        <button
          type="button"
          className="quick-modes__chip"
          aria-pressed={other}
          disabled={busy}
          onClick={() => setOtherOpen(true)}
        >
          {other && chosen !== null ? `Other: ${transportModeInfo[chosen].short}` : "Other"}
        </button>
        <button
          type="button"
          className="quick-modes__chip"
          aria-pressed={chosen === null}
          disabled={busy}
          onClick={() => pick(null)}
        >
          {chosen === null && detected !== null && detected !== "unknown"
            ? `Auto: ${transportModeInfo[detected].short}`
            : "Auto"}
        </button>
      </fieldset>
      {description === undefined ? null : (
        <p className="quick-modes__description" id={descriptionId}>
          {description}
        </p>
      )}
      {set.isError ? (
        <p className="quick-modes__error" role="alert">
          {errorMessage(set.error)}
        </p>
      ) : null}
      <Dialog
        open={otherOpen}
        onClose={() => setOtherOpen(false)}
        title={dialogTitle ?? `How is ${deviceName} travelling?`}
        description="From now until the next stop."
      >
        <ModePicker
          label="Mode from now on"
          current={chosen}
          disabled={set.isPending}
          onPick={(next) => {
            setOtherOpen(false);
            pick(next);
          }}
        />
      </Dialog>
    </div>
  );
}
