import type { ReactNode } from "react";
import { Link } from "react-router";
import "../../ui/BackLink.css";
import { Icon } from "../../ui/Icon";
import "./PanelLevel.css";

interface PanelLevelProps {
  title: string;
  /** Where the way back leads: the level above, as an address. */
  backTo: string;
  /** The level above, as its name: "People" ("Back to People"). */
  backLabel: string;
  children: ReactNode;
}

/**
 * A level of the sidebar below the root, in place of the one above: the way
 * back, then the level's name as a heading that takes the focus when it opens
 * (usePanelFocus).
 */
export function PanelLevel({ title, backTo, backLabel, children }: PanelLevelProps) {
  return (
    <div className="panel-level">
      <Link to={backTo} className="back-link" preventScrollReset>
        <Icon name="chevronLeft" className="back-link__icon" />
        <span className="back-link__label">
          <span className="visually-hidden">Back to</span> {backLabel}
        </span>
      </Link>
      <h2 className="panel-level__title" tabIndex={-1} data-level-heading>
        {title}
      </h2>
      {children}
    </div>
  );
}
