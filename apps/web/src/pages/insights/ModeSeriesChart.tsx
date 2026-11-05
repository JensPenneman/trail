import type { InsightsOverview } from "@trail/contracts/insights";
import { useMemo } from "react";
import { BarChart } from "../../charts/BarChart";
import type { ChartSeries } from "../../charts/chartTypes";
import { describeBars } from "../../charts/summaries";
import { useFormatter } from "../../format/useFormatter";
import { transportModeInfo } from "../../transport/transportModes";
import { bucketLabels, perBucket } from "./bucketLabels";
import { foldModes } from "./foldModes";
import { axisFormats } from "./insightsFormat";

/**
 * Distance per day, week or month, stacked by mode in the modes' fixed order;
 * past seven modes the smallest fold into "Other modes".
 */
export function ModeSeriesChart({ overview }: { overview: InsightsOverview }) {
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const { period } = overview;
  const chart = useMemo(() => {
    const { shown, folded } = foldModes(overview.modes);
    const series: ChartSeries[] = [
      ...shown.map((mode) => ({ key: mode, label: transportModeInfo[mode].label, tone: mode })),
      ...(folded.length > 0
        ? [{ key: "other", label: "Other modes", tone: "muted" as const }]
        : []),
    ];
    const labels = bucketLabels(period.bucket, format.locale);
    const rows = period.buckets.map((bucket) => {
      const values = series.map(() => 0);
      for (const entry of overview.series) {
        if (entry.bucket !== bucket) continue;
        const index = shown.indexOf(entry.mode);
        const at = index >= 0 ? index : series.length - 1;
        values[at] = (values[at] ?? 0) + entry.distanceM;
      }
      return { key: bucket, label: labels.label(bucket), tick: labels.tick(bucket), values };
    });
    return { series, rows };
  }, [overview, period, format.locale]);
  return (
    <BarChart
      title={`Distance ${perBucket[period.bucket]}, by mode`}
      summary={describeBars(chart.rows, chart.series, format.distance)}
      series={chart.series}
      rows={chart.rows}
      formatValue={format.distance}
      formatTick={axes.distance}
      categoryLabel={period.bucket === "day" ? "Day" : period.bucket === "week" ? "Week" : "Month"}
    />
  );
}
