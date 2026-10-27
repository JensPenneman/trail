import type { InsightsWayKind } from "@trail/contracts/insights";
import { useMemo } from "react";
import { BarChart } from "../../charts/BarChart";
import type { ChartTone } from "../../charts/chartTypes";
import { useFormatter } from "../../format/useFormatter";
import { axisFormats } from "./insightsFormat";
import { wayKindLabels } from "./wayLabels";

interface WayKindBarsProps {
  title: string;
  kinds: readonly InsightsWayKind[];
  tone: ChartTone;
}

/** Distance by kind of way, motorways down to paths, then rails, ferries and off the map. */
export function WayKindBars({ title, kinds, tone }: WayKindBarsProps) {
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const rows = kinds.map((row) => ({
    key: row.kind,
    label: wayKindLabels[row.kind],
    values: [row.distanceM],
  }));
  const largest = [...kinds].sort((a, b) => b.distanceM - a.distanceM)[0];
  // The kinds add up to the distance with map data, which their shares are of.
  const mapped = kinds.reduce((sum, row) => sum + row.distanceM, 0);
  return (
    <BarChart
      title={title}
      summary={
        largest === undefined
          ? "No map data for these moves."
          : `Most on ${wayKindLabels[largest.kind].toLowerCase()}: ${format.percent(largest.share)} (${format.distance(largest.distanceM)}).`
      }
      series={[{ key: "distance", label: "Distance", tone }]}
      rows={rows}
      orientation="horizontal"
      valueLabels
      formatValue={(metres) =>
        `${format.distance(metres)} · ${format.percent(mapped > 0 ? metres / mapped : 0)}`
      }
      formatTick={axes.distance}
      categoryLabel="Kind of way"
    />
  );
}
