import type { InsightsOverview } from "@trail/contracts/insights";
import { useMemo, useState } from "react";
import { BarChart } from "../../charts/BarChart";
import type { ChartSeries } from "../../charts/chartTypes";
import { describeBars } from "../../charts/summaries";
import { useFormatter } from "../../format/useFormatter";
import { transportModeInfo } from "../../transport/transportModes";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { bucketLabels, perBucket } from "./bucketLabels";
import { foldModes } from "./foldModes";
import { axisFormats } from "./insightsFormat";
import "./ModeSeriesChart.css";

type Measure = "distance" | "time";

/**
 * Distance (or time) per day, week or month, stacked by mode in the modes'
 * fixed order; past seven modes the smallest fold into "Other modes".
 */
export function ModeSeriesChart({ overview }: { overview: InsightsOverview }) {
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const [measure, setMeasure] = useState<Measure>("distance");
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
        const value = measure === "distance" ? entry.distanceM : entry.durationS;
        const index = shown.indexOf(entry.mode);
        const at = index >= 0 ? index : series.length - 1;
        values[at] = (values[at] ?? 0) + value;
      }
      return { key: bucket, label: labels.label(bucket), tick: labels.tick(bucket), values };
    });
    return { series, rows };
  }, [overview, period, measure, format.locale]);
  const formatValue = measure === "distance" ? format.distance : format.duration;
  return (
    <div className="mode-series">
      <SegmentedControl
        label="Show"
        value={measure}
        options={[
          { value: "distance", label: "Distance" },
          { value: "time", label: "Time" },
        ]}
        onChange={setMeasure}
      />
      <BarChart
        title={`${measure === "distance" ? "Distance" : "Time on the move"} ${perBucket[period.bucket]}, by mode`}
        summary={describeBars(chart.rows, chart.series, formatValue)}
        series={chart.series}
        rows={chart.rows}
        formatValue={formatValue}
        formatTick={measure === "distance" ? axes.distance : axes.duration}
        categoryLabel={
          period.bucket === "day" ? "Day" : period.bucket === "week" ? "Week" : "Month"
        }
      />
    </div>
  );
}
