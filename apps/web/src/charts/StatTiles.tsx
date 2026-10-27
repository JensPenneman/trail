import type { ReactNode } from "react";
import "./StatTiles.css";

interface StatTilesProps {
  /** Names the group of tiles when no heading does. */
  label?: string;
  /** `StatTile`s. */
  children: ReactNode;
}

/** Headline numbers as a grid of tiles, one description list. */
export function StatTiles({ label, children }: StatTilesProps) {
  const list = <dl className="stat-tiles__list">{children}</dl>;
  // A description list takes no name of its own; a labelled group around it does.
  return label === undefined ? (
    <div className="stat-tiles">{list}</div>
  ) : (
    // biome-ignore lint/a11y/useSemanticElements: a group of figures, not of form controls a fieldset would hold
    <div className="stat-tiles" role="group" aria-label={label}>
      {list}
    </div>
  );
}
