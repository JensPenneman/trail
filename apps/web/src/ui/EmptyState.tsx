import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import "./EmptyState.css";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Heading level inside the page outline. */
  level?: 2 | 3;
}

export function EmptyState({ icon, title, children, action, level = 2 }: EmptyStateProps) {
  const Heading = level === 2 ? "h2" : "h3";
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
