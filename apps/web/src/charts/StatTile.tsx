import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/iconPaths";
import "./StatTile.css";

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** A second line in secondary ink: "in 12 moves". */
  detail?: ReactNode;
  /** The change against a named period ("12 % more than the 30 days before"), with its direction. */
  delta?: { text: string; direction: "up" | "down" | "flat" } | null;
  icon?: IconName;
}

/*
 * Travel is neither good nor bad, so a delta has no good/bad colour: an
 * arrow for its direction and the text, which says it in words, in
 * secondary ink.
 */
const arrows = {
  up: "arrowUpRight",
  down: "arrowDownRight",
  flat: "arrowRight",
} as const satisfies Record<"up" | "down" | "flat", IconName>;

/** One headline number of a `StatTiles` list: a term and its value, with an optional detail and delta. */
export function StatTile({ label, value, detail, delta, icon }: StatTileProps) {
  return (
    <div className="stat-tile">
      <dt className="stat-tile__label">
        {icon === undefined ? null : <Icon name={icon} className="stat-tile__icon" />}
        {label}
      </dt>
      <dd className="stat-tile__value">{value}</dd>
      {detail === undefined ? null : <dd className="stat-tile__detail">{detail}</dd>}
      {delta === undefined || delta === null ? null : (
        <dd className="stat-tile__delta">
          <Icon name={arrows[delta.direction]} className="stat-tile__icon" />
          {delta.text}
        </dd>
      )}
    </div>
  );
}
