import { type ReactNode, type SelectHTMLAttributes, useId } from "react";
import { Icon } from "./Icon";
import "./Field.css";

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...selectProps
}: SelectFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error ? errorId : null]
    .filter((value) => value !== null)
    .join(" ");
  return (
    <div className={className === undefined ? "field" : `field ${className}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint === undefined ? null : (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      <div className="select">
        <select
          {...selectProps}
          id={id}
          className="input select__control"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy === "" ? undefined : describedBy}
        >
          {children}
        </select>
        <Icon name="chevronDown" className="select__chevron" />
      </div>
      {error ? (
        <p className="field__error" id={errorId}>
          <Icon name="warning" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
