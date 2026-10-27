import type { InsightsMode } from "@trail/contracts/insights";
import { useMemo, useState } from "react";
import { BarChart } from "../../charts/BarChart";
import { describeExtremes } from "../../charts/summaries";
import { useFormatter } from "../../format/useFormatter";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { axisFormats } from "./insightsFormat";
import "./ModeTimeCharts.css";

type Measure = "distance" | "time";

const pad = (value: number) => String(value).padStart(2, "0");

/** When this mode is used: per hour of the day and per day of the week, by distance or time. */
export function ModeTimeCharts({ insights }: { insights: InsightsMode }) {
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const [measure, setMeasure] = useState<Measure>("time");
  const pick = (entry: { distanceM: number; durationS: number }) =>
    measure === "distance" ? entry.distanceM : entry.durationS;
  const formatValue = measure === "distance" ? format.distance : format.duration;
  const series = [
    {
      key: measure,
      label: measure === "distance" ? "Distance" : "Time",
      tone: insights.mode,
    },
  ];
  const hours = insights.byHour.map((entry) => ({
    key: String(entry.hour),
    label: `${pad(entry.hour)}:00–${pad((entry.hour + 1) % 24)}:00`,
    tick: pad(entry.hour),
    values: [pick(entry)],
  }));
  const weekdayNames = format.weekdays(1);
  const weekdays = insights.byWeekday.map((entry) => ({
    key: String(entry.weekday),
    label: weekdayNames[entry.weekday - 1]?.long ?? String(entry.weekday),
    tick: weekdayNames[entry.weekday - 1]?.short ?? String(entry.weekday),
    values: [pick(entry)],
  }));
  const extremes = (rows: typeof hours) =>
    describeExtremes(
      rows.map((row) => ({ label: row.label, value: row.values[0] ?? 0 })),
      formatValue,
    );
  const noun = measure === "distance" ? "Distance" : "Time";
  return (
    <div className="mode-time">
      <SegmentedControl
        label="Show"
        value={measure}
        options={[
          { value: "time", label: "Time" },
          { value: "distance", label: "Distance" },
        ]}
        onChange={setMeasure}
      />
      <div className="mode-time__charts">
        <BarChart
          title={`${noun} by hour of the day`}
          summary={extremes(hours)}
          series={series}
          rows={hours}
          formatValue={formatValue}
          formatTick={measure === "distance" ? axes.distance : axes.duration}
          categoryLabel="Hour"
        />
        <BarChart
          title={`${noun} by day of the week`}
          summary={extremes(weekdays)}
          series={series}
          rows={weekdays}
          formatValue={formatValue}
          formatTick={measure === "distance" ? axes.distance : axes.duration}
          categoryLabel="Day"
        />
      </div>
    </div>
  );
}
