import { type ReactNode, useId } from "react";
import "./Switch.css";

interface SwitchProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off setting that takes effect immediately (no form to submit). */
export function Switch({ label, description, checked, disabled, busy, onChange }: SwitchProps) {
  const id = useId();
  return (
    <div className="switch">
      <div className="switch__text">
        <label className="switch__label" htmlFor={id}>
          {label}
        </label>
        {description === undefined ? null : (
          <p className="switch__description" id={`${id}-description`}>
            {description}
          </p>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch__control"
        checked={checked}
        aria-checked={checked}
        disabled={disabled === true || busy === true}
        aria-busy={busy === true ? true : undefined}
        aria-describedby={description === undefined ? undefined : `${id}-description`}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </div>
  );
}
