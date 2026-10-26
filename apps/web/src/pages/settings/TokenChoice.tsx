import { useId } from "react";

interface TokenChoiceProps {
  type: "radio" | "checkbox";
  /** The radio group's name. */
  name?: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  /** `option`: a framed card (templates, devices); `scope`: a compact row with a code-style label. */
  look: "option" | "scope";
  onChange: (checked: boolean) => void;
}

/**
 * One radio button or checkbox of the token form. The label alone names the
 * control and the description describes it, so "Read-only" stays "Read-only"
 * to a screen reader, and to `getByRole` in the tests.
 */
export function TokenChoice({
  type,
  name,
  label,
  description,
  checked,
  disabled,
  look,
  onChange,
}: TokenChoiceProps) {
  const id = useId();
  const classes = [look === "option" ? "token-option" : "token-scope"];
  if (look === "option" && checked) classes.push("is-chosen");
  return (
    <label className={classes.join(" ")}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={description === undefined ? undefined : `${id}-description`}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="token-option__text">
        <span
          className={look === "option" ? "token-option__label" : "token-scope__name mono"}
          id={`${id}-label`}
        >
          {label}
        </span>
        {description === undefined ? null : (
          <span className="token-option__description" id={`${id}-description`}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
