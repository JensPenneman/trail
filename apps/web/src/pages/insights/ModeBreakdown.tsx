import type { InsightsModeShare } from "@trail/contracts/insights";
import { useMemo } from "react";
import { BarChart } from "../../charts/BarChart";
import { useFormatter } from "../../format/useFormatter";
import { transportModeInfo } from "../../transport/transportModes";
import { axisFormats } from "./insightsFormat";

/** One bar per mode, in its colour, for its part of the distance: the period's mix at a glance. */
export function ModeBreakdown({ modes }: { modes: readonly InsightsModeShare[] }) {
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const rows = useMemo(
    () =>
      modes.map((row) => ({
        key: row.mode,
        label: transportModeInfo[row.mode].label,
        values: [row.distanceM],
        tone: row.mode,
      })),
    [modes],
  );
  const total = modes.reduce((sum, row) => sum + row.distanceM, 0);
  const [first] = modes;
  const summary =
    first === undefined
      ? "No moves in this period."
      : modes.length === 1
        ? `All of the distance: ${transportModeInfo[first.mode].label}, ${format.distance(first.distanceM)}.`
        : `${transportModeInfo[first.mode].label}: most of the distance, ${format.percent(first.share)} (${format.distance(first.distanceM)}).`;
  return (
    <BarChart
      title="Distance by mode"
      summary={summary}
      series={[{ key: "distance", label: "Distance", tone: "accent" }]}
      rows={rows}
      orientation="horizontal"
      valueLabels
      formatValue={(metres) =>
        `${format.distance(metres)} · ${format.percent(total > 0 ? metres / total : 0)}`
      }
      formatTick={axes.distance}
      categoryLabel="Mode"
    />
  );
}
