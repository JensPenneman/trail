import type { InsightsOverview } from "@trail/contracts/insights";
import { StatTile } from "../../charts/StatTile";
import { StatTiles } from "../../charts/StatTiles";
import { useFormatter } from "../../format/useFormatter";
import { changeOf } from "./insightsFormat";
import { comparisonPhrase } from "./insightsSearch";

interface OverviewTilesProps {
  overview: InsightsOverview;
  /** Whether to compare with the period before: not for all of the history, nor with an empty one. */
  compare: boolean;
}

/** The headline numbers of a period, each with its change against the period of as many days before. */
export function OverviewTiles({ overview, compare }: OverviewTilesProps) {
  const format = useFormatter();
  const { totals, previous, period } = overview;
  const compared = comparisonPhrase(period.days);
  const change = (now: number, before: number, kind: "amount" | "count") =>
    compare ? changeOf(now, before, compared, { kind, format }) : null;
  return (
    <StatTiles label="Totals">
      <StatTile
        label="Distance"
        icon="route"
        value={format.distance(totals.distanceM)}
        delta={change(totals.distanceM, previous.totals.distanceM, "amount")}
      />
      <StatTile
        label="On the move"
        icon="history"
        value={format.duration(totals.durationS)}
        delta={change(totals.durationS, previous.totals.durationS, "amount")}
      />
      <StatTile
        label="Moves"
        value={format.count(totals.moves)}
        delta={change(totals.moves, previous.totals.moves, "count")}
      />
      <StatTile
        label="Stops"
        value={format.count(totals.stops)}
        delta={change(totals.stops, previous.totals.stops, "count")}
      />
      <StatTile
        label="Active days"
        value={format.count(totals.activeDays)}
        detail={`of ${format.count(period.days)} ${period.days === 1 ? "day" : "days"}`}
        delta={change(totals.activeDays, previous.totals.activeDays, "count")}
      />
    </StatTiles>
  );
}
