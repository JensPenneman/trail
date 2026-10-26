import type { ChosenMode } from "@trail/contracts/transport";
import { Icon } from "../ui/Icon";
import { chosenModes, transportModeInfo } from "./transportModes";
import "./ModePicker.css";

interface ModePickerProps {
  /** Names the group for assistive technology ("Change the mode"). */
  label: string;
  /** The mode marked as current, if any. */
  current: ChosenMode | null;
  disabled?: boolean;
  onPick: (mode: ChosenMode) => void;
}

/**
 * Every mode a person can choose, as buttons: one press applies it (a radio
 * group would send a request for every arrow key), the current one is
 * pressed.
 */
export function ModePicker({ label, current, disabled = false, onPick }: ModePickerProps) {
  return (
    <fieldset className="mode-picker">
      <legend className="visually-hidden">{label}</legend>
      {chosenModes.map((mode) => (
        <button
          key={mode}
          type="button"
          className={`mode-picker__option mode-color-${mode}`}
          aria-pressed={current === mode}
          disabled={disabled}
          onClick={() => onPick(mode)}
        >
          <Icon name={transportModeInfo[mode].icon} />
          <span>{transportModeInfo[mode].label}</span>
        </button>
      ))}
    </fieldset>
  );
}
