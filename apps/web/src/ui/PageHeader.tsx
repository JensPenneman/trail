import type { ReactNode } from "react";
import "./PageHeader.css";

interface PageHeaderProps {
  title: string;
  /** Short line under the title. */
  description?: ReactNode;
  actions?: ReactNode;
  /** Shown above the title, e.g. a back link. */
  eyebrow?: ReactNode;
}

/**
 * The page's h1. It is the focus target after every navigation, so screen
 * reader users land on the new page's name (see useRouteFocus).
 */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {eyebrow === undefined ? null : <div className="page-header__eyebrow">{eyebrow}</div>}
        <h1 className="page-header__title" tabIndex={-1} data-page-title>
          {title}
        </h1>
        {description === undefined ? null : (
          <div className="page-header__description">{description}</div>
        )}
      </div>
      {actions === undefined ? null : <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
