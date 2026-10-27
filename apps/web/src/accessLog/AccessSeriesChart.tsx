import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import { useMemo } from "react";
import { BarChart } from "../charts/BarChart";
import type { ChartTone } from "../charts/chartTypes";
import { describeBars } from "../charts/summaries";
import { useFormatter } from "../format/useFormatter";
import { bucketLabels } from "../pages/insights/bucketLabels";

type Day = DataAccessSummary["series"][number];

/** One series of the chart: what it counts of a day. */
export interface AccessSeries {
  key: string;
  label: string;
  tone: ChartTone;
  value: (day: Day) => number;
}

interface AccessSeriesChartProps {
  title: string;
  summary: DataAccessSummary;
  series: readonly AccessSeries[];
}

/**
 * Accesses per local day of a summary's period, stacked by the series given
 * (who, or which channel), with the numbers in a table.
 */
export function AccessSeriesChart({ title, summary, series }: AccessSeriesChartProps) {
  const format = useFormatter();
  const chart = useMemo(() => {
    const labels = bucketLabels("day", format.locale);
    const rows = summary.series.map((day) => ({
      key: day.date,
      label: labels.label(day.date),
      tick: labels.tick(day.date),
      values: series.map((item) => item.value(day)),
    }));
    return {
      rows,
      series: series.map(({ key, label, tone }) => ({ key, label, tone })),
    };
  }, [summary, series, format.locale]);
  return (
    <BarChart
      title={title}
      summary={describeBars(chart.rows, chart.series, format.count)}
      series={chart.series}
      rows={chart.rows}
      formatValue={format.count}
      integer
      categoryLabel="Day"
    />
  );
}
