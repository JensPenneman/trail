import { useMemo } from "react";
import { HeatGrid } from "../../charts/HeatGrid";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsTime } from "../../queries/useInsightsTime";
import { transportModeInfo } from "../../transport/transportModes";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsScreen } from "./InsightsScreen";
import { insightsRootPath } from "./insightsLevels";
import { insightsLink } from "./insightsLinks";
import { useInsightsPeriod } from "./useInsightsPeriod";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * When you travel (`/insights/time`): the hours of the week you spend on the
 * move — every mode, or the one the address names — as a grid of weekdays by
 * hours.
 */
export function WhenScreen() {
  const state = useInsightsPeriod();
  const format = useFormatter();
  const time = useInsightsTime(state.query(true));
  const data = time.data;
  const grid = useMemo(() => {
    const weekdays = format.weekdays(1);
    const rows = weekdays.map((day, index) => ({
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
    const summary =
      busiest === null
        ? "No time on the move in this period."
        : `Most often on ${rows[busiest.row]?.label ?? ""} at ${pad(busiest.hour)}:00 (${format.duration(busiest.value)}); ${format.duration(total)} on the move in all.`;
    return { rows, columns, values, summary };
  }, [data, format]);
  const mode = state.mode;
  const subject =
    mode === null ? "on the move" : `by ${transportModeInfo[mode].label.toLowerCase()}`;

  return (
    <InsightsScreen
      state={state}
      title="When you travel"
      documentTitle="When you travel · Insights"
      up={{ to: insightsLink(insightsRootPath, state.params), label: "Insights", always: false }}
      pending={data?.pending ?? false}
      updating={time.isPlaceholderData}
    >
      {time.isPending ? (
        <LoadingBlock label="Loading when you travel">
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : time.isError ? (
        <ErrorState
          title="Insights could not be loaded"
          error={time.error}
          onRetry={() => void time.refetch()}
          retrying={time.isFetching}
        />
      ) : (
        <HeatGrid
          title={`Time ${subject} by weekday and hour`}
          summary={grid.summary}
          rows={grid.rows}
          columns={grid.columns}
          values={grid.values}
          cellLabel={(row, column) => `${row.label}, ${column.label}`}
          formatValue={format.duration}
          categoryLabel="Day"
        />
      )}
    </InsightsScreen>
  );
}
