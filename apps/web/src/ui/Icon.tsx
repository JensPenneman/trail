import { type IconName, iconPaths } from "./iconPaths";
import "./Icon.css";

interface IconProps {
  name: IconName;
  /** Rendered size in px (defaults to 1.25em through CSS). */
  size?: number;
  /** Only for icons that carry meaning on their own; decorative icons stay hidden from screen readers. */
  label?: string;
  className?: string;
}

export function Icon({ name, size, label, className }: IconProps) {
  return (
    <svg
      className={className === undefined ? "icon" : `icon ${className}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      focusable="false"
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
    >
      {label === undefined ? null : <title>{label}</title>}
      <path d={iconPaths[name]} />
    </svg>
  );
}
