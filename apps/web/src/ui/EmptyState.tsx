import { type ReactNode, use } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import { SectionLevel } from "./SectionTitle";
import "./EmptyState.css";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Heading level inside the page outline. */
  level?: 2 | 3;
  /** Under the section title around it, one level down from the sections' own. */
  nested?: boolean;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  level,
  nested = false,
}: EmptyStateProps) {
  // Unless the page says which, a level under whatever it sits in (a detail's parts are h3).
  const sections = use(SectionLevel);
  const Heading = `h${level ?? (nested ? sections + 1 : sections)}` as "h2" | "h3" | "h4";
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon name={icon} size={28} />
      </span>
      <Heading className="empty-state__title">{title}</Heading>
      {children === undefined ? null : <div className="empty-state__body">{children}</div>}
      {action === undefined ? null : <div className="empty-state__action">{action}</div>}
    </div>
  );
}
