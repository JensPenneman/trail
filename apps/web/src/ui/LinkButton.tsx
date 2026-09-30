import type { ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import type { ButtonVariant } from "./Button";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import "./Button.css";

interface LinkButtonProps extends Omit<LinkProps, "className" | "children"> {
  variant?: ButtonVariant;
  icon?: IconName;
  wide?: boolean;
  children: ReactNode;
}

/** A router link that looks like a button, for actions that are really navigation. */
export function LinkButton({
  variant = "secondary",
  icon,
  wide = false,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link {...rest} className={`button button--${variant}${wide ? " button--wide" : ""}`}>
      {icon === undefined ? null : <Icon name={icon} />}
      <span>{children}</span>
    </Link>
  );
}
