import { type ReactNode, useId } from "react";
import "./CheckboxField.css";

interface CheckboxFieldProps {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A yes/no choice inside a form (submitted with it), with what it means beneath the label. */
export function CheckboxField({ label, hint, checked, disabled, onChange }: CheckboxFieldProps) {
  const hintId = useId();
  return (
    <label className="checkbox-field" data-disabled={disabled === true ? true : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="checkbox-field__text">
        <span className="checkbox-field__label">{label}</span>
        {hint === undefined ? null : (
          <span className="checkbox-field__hint" id={hintId}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
