import type { ReactNode } from "react";
import { StatTile } from "../../charts/StatTile";
import { StatTiles } from "../../charts/StatTiles";
import type { Formatter } from "../../format/createFormatter";
import { type Change, changeOf } from "./insightsFormat";
import type { Comparison } from "./useInsightsComparison";

interface InsightsHeroProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** Left out where the number is not compared (the pattern screens). */
  change?: HeroChange;
}

/** What the hero says about the period before: a change, or why there is none to state. */
export interface HeroChange {
  delta: Change | null;
  /** In place of a change: nothing was recorded in the days to compare with. */
  note: string | null;
}

/**
 * How `now` stands against the same measure in the days compared with. An
 * earlier period with nothing recorded gives a note, not an arrow; an arrow is
 * never good or bad, travel is neither.
 */
export function heroChange(
  comparison: Comparison | null,
  now: number,
  before: number,
  format: Formatter,
): HeroChange {
  if (comparison === null) return { delta: null, note: null };
  if (comparison.empty) {
    return { delta: null, note: `Nothing recorded in ${comparison.name} to compare with.` };
  }
  return { delta: changeOf(now, before, comparison.name, { kind: "amount", format }), note: null };
}

/** The one number a screen is about: large, with a line under it and the change against the period before. */
export function InsightsHero({ label, value, detail, change }: InsightsHeroProps) {
  const delta = change?.delta ?? null;
  const note = change?.note ?? null;
  return (
    <div className="insights-hero">
      <StatTiles label="Totals">
        <StatTile
          label={label}
          value={value}
          {...(detail === undefined ? {} : { detail })}
          delta={delta}
        />
      </StatTiles>
      {note === null ? null : <p className="muted insights-hero__note">{note}</p>}
    </div>
  );
}
