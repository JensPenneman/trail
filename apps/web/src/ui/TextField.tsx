import { type InputHTMLAttributes, type ReactNode, type Ref, useId } from "react";
import { Icon } from "./Icon";
import "./Field.css";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "children"> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled input whose hint and error are wired to it for screen readers. */
export function TextField({ label, hint, error, className, ref, ...inputProps }: TextFieldProps) {
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
      <input
        {...inputProps}
        ref={ref}
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
      />
      {error ? (
        <p className="field__error" id={errorId}>
          <Icon name="warning" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
