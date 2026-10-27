import { type ReactNode, useId } from "react";
import { PlainList } from "../ui/PlainList";
import "./SettingsGroup.css";

interface SettingsGroupProps {
  title?: string;
  /** The heading's id, so `#id` in an address leads here (and the heading can take focus). */
  id?: string;
  /** A heading on pages; a plain label in the sidebar, whose page brings its own h1 later. */
  titleAs?: "h2" | "p";
  /** `list`: rows; `facts`: labels and values; `card`: anything else, such as a form; `flush`: a card without padding (a table). */
  variant?: "list" | "facts" | "card" | "flush";
  /** Under the group, in small print. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * A titled inset block of a Settings page, as on the iPhone: rows on a card,
 * the title above it, small print below. A list takes its name from the title.
 */
export function SettingsGroup({
  title,
  id,
  titleAs = "h2",
  variant = "list",
  footer,
  children,
}: SettingsGroupProps) {
  const generatedId = useId();
  const headingId = id ?? generatedId;
  const Title = titleAs;
  return (
    <div className="settings-group">
      {title === undefined ? null : (
        <Title
          className="settings-group__title"
          id={headingId}
          tabIndex={id === undefined ? undefined : -1}
        >
          {title}
        </Title>
      )}
      {variant === "list" ? (
        <PlainList
          className="settings-group__body"
          {...(title === undefined ? {} : { labelledBy: headingId })}
        >
          {children}
        </PlainList>
      ) : variant === "facts" ? (
        <dl className="settings-group__body">{children}</dl>
      ) : (
        <div className={`settings-group__body settings-group__body--${variant}`}>{children}</div>
      )}
      {footer === undefined ? null : <div className="settings-group__footer">{footer}</div>}
    </div>
  );
}
