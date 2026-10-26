import { type ReactNode, useId } from "react";
import "./ChoiceList.css";

interface Choice<T extends string> {
  value: T;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

interface ChoiceListProps<T extends string> {
  legend: string;
  hint?: ReactNode;
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  /** Two columns on wide screens for short labels without descriptions. */
  compact?: boolean;
}

/** One choice out of a few, each with a sentence that says what it means: native radio buttons. */
export function ChoiceList<T extends string>({
  legend,
  hint,
  value,
  options,
  onChange,
  compact = false,
}: ChoiceListProps<T>) {
  const name = useId();
  const hintId = useId();
  return (
    <fieldset
      className={compact ? "choices choices--compact" : "choices"}
      aria-describedby={hint === undefined ? undefined : hintId}
    >
      <legend className="field__label">{legend}</legend>
      {hint === undefined ? null : (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      <div className="choices__list">
        {options.map((option) => (
          <label
            key={option.value}
            className={option.value === value ? "choice is-chosen" : "choice"}
            data-disabled={option.disabled === true ? true : undefined}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="choice__text">
              <span className="choice__label">{option.label}</span>
              {option.description === undefined ? null : (
                <span className="choice__description">{option.description}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
