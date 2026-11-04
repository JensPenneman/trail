import { HeatGrid } from "../../charts/HeatGrid";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsTime } from "../../queries/useInsightsTime";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { type ModeContext, WithMode } from "./modeRoute";
import { useTimeGrid } from "./timeGrid";

function Body({ mode, label, state, up }: ModeContext) {
  const format = useFormatter();
  const time = useInsightsTime({ ...state.query(), mode });
  const data = time.data;
  const grid = useTimeGrid(data, format);
  const lower = label.toLowerCase();
  return (
    <InsightsScreen
      state={state}
      title="When"
      documentTitle={`When · ${label} · Insights`}
      up={up}
      pending={data?.pending ?? false}
      updating={time.isPlaceholderData}
    >
      {time.isPending ? (
        <LoadingBlock label={`Loading when you use ${lower}`}>
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
      ) : grid.total <= 0 ? (
        <div className="card">
          <EmptyState icon="calendar" title={`No ${lower} in this period`}>
            <p>Choose another period, or another device.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <InsightsHero
            label={`By ${lower}`}
            value={format.duration(grid.total)}
            detail={
              grid.most === null ? `No ${lower} in this period.` : `Most often on ${grid.most}`
            }
          />
          <HeatGrid
            title={`Time by ${lower} by weekday and hour`}
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

/** A mode's When (`/insights/transport/:mode/time`): its hours of the week as a grid. */
export function ModeWhenScreen() {
  return <WithMode part render={(context) => <Body {...context} />} />;
}
