import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import { Spinner } from "./Spinner";
import "./Button.css";

/** `danger-outline` opens a confirmation; the filled `danger` is the final, destructive press. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  icon?: IconName;
  /** Shows a spinner, keeps the width and blocks repeated presses while a request runs. */
  busy?: boolean;
  /** Icon-only button: `children` becomes the accessible name instead of visible text. */
  iconOnly?: boolean;
  wide?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  icon,
  busy = false,
  iconOnly = false,
  wide = false,
  type = "button",
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = ["button", `button--${variant}`];
  if (iconOnly) classes.push("button--icon-only");
  if (wide) classes.push("button--wide");
  if (className !== undefined) classes.push(className);
  return (
    <button
      {...rest}
      type={type}
      className={classes.join(" ")}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <Spinner size="s" /> : icon === undefined ? null : <Icon name={icon} />}
      {iconOnly ? <span className="visually-hidden">{children}</span> : <span>{children}</span>}
    </button>
  );
}
