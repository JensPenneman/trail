import type { InsightsMode } from "@trail/contracts/insights";
import { useMemo } from "react";
import { LineChart } from "../../charts/LineChart";
import { describeExtremes } from "../../charts/summaries";
import { useFormatter } from "../../format/useFormatter";
import { bucketLabels, perBucket } from "./bucketLabels";
import { axisFormats } from "./insightsFormat";

/** The mode's distance over the period, per day, week or month. */
export function ModeTrend({ insights }: { insights: InsightsMode }) {
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const { period } = insights;
  const labels = bucketLabels(period.bucket, format.locale);
  const rows = insights.series.map((step) => ({
    key: step.bucket,
    label: labels.label(step.bucket),
    tick: labels.tick(step.bucket),
    values: [step.distanceM],
  }));
  return (
    <LineChart
      title={`Distance ${perBucket[period.bucket]}`}
      summary={describeExtremes(
        rows.map((row) => ({ label: row.label, value: row.values[0] ?? 0 })),
        format.distance,
      )}
      series={[{ key: "distance", label: "Distance", tone: insights.mode }]}
      rows={rows}
      formatValue={format.distance}
      formatTick={axes.distance}
      area
      categoryLabel={period.bucket === "day" ? "Day" : period.bucket === "week" ? "Week" : "Month"}
    />
  );
}
