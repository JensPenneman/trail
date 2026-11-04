import { HeatGrid } from "../../charts/HeatGrid";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsTime } from "../../queries/useInsightsTime";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { insightsRootPath } from "./insightsLevels";
import { insightsLink } from "./insightsLinks";
import { useTimeGrid } from "./timeGrid";
import { useInsightsPeriod } from "./useInsightsPeriod";

/**
 * When you travel (`/insights/time`): the hours of the week you spend on the
 * move, as a grid of weekdays by hours, under the time on the move in all.
 */
export function WhenScreen() {
  const state = useInsightsPeriod();
  const format = useFormatter();
  const time = useInsightsTime(state.query());
  const data = time.data;
  const grid = useTimeGrid(data, format);
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
          <Skeleton height="6rem" />
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
        <>
          <InsightsHero
            label="On the move"
            value={format.duration(grid.total)}
            detail={
              grid.most === null
                ? "No time on the move in this period."
                : `Most often on ${grid.most}`
            }
          />
          <HeatGrid
            title="Time on the move by weekday and hour"
            summary={grid.summary}
            rows={grid.rows}
            columns={grid.columns}
            values={grid.values}
            cellLabel={(row, column) => `${row.label}, ${column.label}`}
            formatValue={format.duration}
            categoryLabel="Day"
          />
        </>
      )}
    </InsightsScreen>
  );
}
