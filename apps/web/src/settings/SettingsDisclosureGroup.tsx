import { type ReactNode, useId } from "react";
import { Icon } from "../ui/Icon";
import "./SettingsGroup.css";

interface SettingsDisclosureGroupProps {
  /** The group's name, on its button. */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The heading's level: under a page's name (h2) it is a 3. */
  titleAs?: "h2" | "h3";
  children: ReactNode;
}

/**
 * A group of a Settings-style page that folds: its title is a button inside the
 * heading (so the heading is found as a heading and works as a button), with
 * `aria-expanded` and `aria-controls`; what it holds is rendered only while it
 * is open, so a closed group asks and draws nothing.
 */
export function SettingsDisclosureGroup({
  title,
  open,
  onOpenChange,
  titleAs = "h3",
  children,
}: SettingsDisclosureGroupProps) {
  const id = useId();
  const bodyId = `${id}-body`;
  const Title = titleAs;
  return (
    <div className="settings-group settings-group--disclosure">
      <Title className="settings-group__title settings-group__title--disclosure">
        <button
          type="button"
          className="settings-group__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onOpenChange(!open)}
        >
          <span>{title}</span>
          <Icon name="chevronDown" className="settings-group__chevron" />
        </button>
      </Title>
      {open ? (
        <div className="settings-group__open" id={bodyId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
