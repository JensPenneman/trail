import type { InsightsTime } from "@trail/contracts/insights";
import { useMemo } from "react";
import type { Formatter } from "../../format/createFormatter";

const pad = (value: number) => String(value).padStart(2, "0");

/** The hours of the week as a grid of weekdays by hours, and what stands out in it. */
export function useTimeGrid(data: InsightsTime | undefined, format: Formatter) {
  return useMemo(() => {
    const rows = format.weekdays(1).map((day, index) => ({
      key: String(index + 1),
      label: day.long,
      tick: day.short,
    }));
    const columns = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${pad(hour)}:00–${pad((hour + 1) % 24)}:00`,
      tick: pad(hour),
    }));
    const values = rows.map((_, row) =>
      columns.map((_, hour) => data?.cells[row * 24 + hour]?.durationS ?? 0),
    );
    let busiest: { row: number; hour: number; value: number } | null = null;
    for (const [row, hours] of values.entries()) {
      for (const [hour, value] of hours.entries()) {
        if (value > 0 && (busiest === null || value > busiest.value))
          busiest = { row, hour, value };
      }
    }
    const total = values.flat().reduce((sum, value) => sum + value, 0);
    const most =
      busiest === null ? null : `${rows[busiest.row]?.label ?? ""} at ${pad(busiest.hour)}:00`;
    const summary =
      busiest === null
        ? "No time on the move in this period."
        : `Most often on ${most} (${format.duration(busiest.value)}); ${format.duration(total)} on the move in all.`;
    return { rows, columns, values, summary, total, most };
  }, [data, format]);
}
