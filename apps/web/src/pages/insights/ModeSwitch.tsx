import { type TransportMode, transportModes } from "@trail/contracts/transport";
import { transportModeInfo } from "../../transport/transportModes";
import { SelectField } from "../../ui/SelectField";
import "./ModeSwitch.css";

interface ModeSwitchProps {
  value: TransportMode | null;
  /** The modes with moves in the period (the one chosen stays listed without). */
  modes: readonly TransportMode[];
  onChange: (mode: TransportMode | null) => void;
}

/** Every mode, or one of those moved in during the period. */
export function ModeSwitch({ value, modes, onChange }: ModeSwitchProps) {
  const listed = transportModes.filter((mode) => modes.includes(mode) || mode === value);
  return (
    <SelectField
      label="Mode"
      className="mode-switch"
      value={value ?? ""}
      onChange={(event) => {
        const chosen = event.currentTarget.value;
        onChange(
          (transportModes as readonly string[]).includes(chosen) ? (chosen as TransportMode) : null,
        );
      }}
    >
      <option value="">All modes</option>
      {listed.map((mode) => (
        <option key={mode} value={mode}>
          {transportModeInfo[mode].label}
        </option>
      ))}
    </SelectField>
  );
}
