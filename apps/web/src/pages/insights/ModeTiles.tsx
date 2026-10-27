import type { InsightsMode } from "@trail/contracts/insights";
import { StatTile } from "../../charts/StatTile";
import { StatTiles } from "../../charts/StatTiles";
import { useFormatter } from "../../format/useFormatter";
import { formatKmh } from "./insightsFormat";

/** The headline numbers of one mode: distance, time, moves, speeds, the longest and the fastest. */
export function ModeTiles({ insights }: { insights: InsightsMode }) {
  const format = useFormatter();
  const { totals } = insights;
  return (
    <StatTiles label="Totals">
      <StatTile label="Distance" icon="route" value={format.distance(totals.distanceM)} />
      <StatTile label="Time" icon="history" value={format.duration(totals.durationS)} />
      <StatTile label="Moves" value={format.count(totals.moves)} />
      <StatTile label="Average speed" icon="speed" value={formatKmh(format, totals.avgSpeedKmh)} />
      <StatTile
        label="Typical speed"
        value={totals.typicalSpeedKmh === null ? "—" : formatKmh(format, totals.typicalSpeedKmh)}
        detail="how fast you mostly went"
      />
      <StatTile
        label="Longest"
        value={totals.longest === null ? "—" : format.distance(totals.longest.distanceM)}
        {...(totals.longest === null ? {} : { detail: format.dayTime(totals.longest.startedAt) })}
      />
      <StatTile
        label="Fastest"
        value={totals.fastest === null ? "—" : formatKmh(format, totals.fastest.maxSpeedKmh)}
        {...(totals.fastest === null ? {} : { detail: format.dayTime(totals.fastest.startedAt) })}
      />
    </StatTiles>
  );
}
